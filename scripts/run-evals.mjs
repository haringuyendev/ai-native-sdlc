#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEvals, outputChecks, summarize, timeoutChecks } from '../lib/evals.mjs';
import { getAdapter, ADAPTER_NAMES } from '../adapters/index.mjs';
import { findRoot, changedFiles } from '../lib/repo.mjs';

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_SEC = 600;
const WT_PREFIX = 'sdlc-eval-';

const USAGE = `Dùng: node scripts/run-evals.mjs [--agent claude-code|codex|agy] [--only <tiền tố>] [--min-pass 0..1] [--dry-run] [--json] [--root <thư mục>]
  --agent  agent chạy eval (mặc định claude-code).
  Với codex và agy, runner KHÔNG cài plugin: ai-native-sdlc phải đã được cài sẵn trong agent đó; --plugin-dir-from-head chỉ áp dụng cho claude-code.
  Codex dùng model trong AI_SDLC_CODEX_MODEL (mặc định gpt-6-luna); allowed_tools và args của eval chỉ áp dụng cho claude-code. Codex chạy với "-s workspace-write" và "--dangerously-bypass-hook-trust" (như người dùng đã tin cậy hook).
  agy chạy với "--dangerously-skip-permissions" (headless agy tự từ chối mọi lệnh shell); chỉ trong worktree tạm, hook PreToolUse vẫn chặn, nhưng gate "ask" được tự duyệt. Model của agy lấy từ AI_SDLC_AGY_MODEL (không đặt thì dùng model mặc định của tài khoản).
  max_turns chỉ áp dụng cho claude-code. codex exec và agy -p không giới hạn lượt nên hay chạm timeout_sec; khi đó runner chấm phần output đã nhận (skill_first/skill_never), chưa gọi skill nào thì FAIL "quá thời gian".
`;

// Set by SIGINT/SIGTERM; checked after every claude run so the current worktree is still removed.
let interrupted = false;

// Strips git variables and the parent Claude session's identity, so an eval run
// behaves the same from a terminal and from inside a Claude Code session.
function env() {
  const e = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'CLAUDE_CODE_SESSION_ID']) delete e[k];
  for (const k of Object.keys(e)) if (k.startsWith('CLAUDE_CODE_MESSAGING_')) delete e[k];
  return e;
}

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: env() });
}

// Worktrees left registered by an earlier run that was killed before its cleanup.
function removeStaleWorktrees(root) {
  const tmp = [tmpdir(), realpathSync(tmpdir())].map((d) => join(d, WT_PREFIX));
  const list = git(root, ['worktree', 'list', '--porcelain']);
  for (const l of (list.stdout || '').split('\n')) {
    if (!l.startsWith('worktree ')) continue;
    const wt = l.slice('worktree '.length);
    if (!tmp.some((p) => wt.startsWith(p))) continue;
    git(root, ['worktree', 'remove', '--force', wt]);
    if (basename(dirname(wt)).startsWith(WT_PREFIX)) rmSync(dirname(wt), { recursive: true, force: true });
  }
  git(root, ['worktree', 'prune']);
}

function runOne(root, evalObj, opts, adapter) {
  const failures = [];
  const base = mkdtempSync(join(tmpdir(), WT_PREFIX));
  const wt = join(base, 'wt');
  try {
    const add = git(root, ['worktree', 'add', '--detach', '-q', wt, 'HEAD']);
    if (add.status !== 0) return [`không tạo được worktree: ${(add.stderr || '').trim()}`];

    const name = adapter.displayName.toLowerCase();
    const timeoutSec = evalObj.timeout_sec ?? DEFAULT_TIMEOUT_SEC;
    const { bin, argv } = adapter.evalCommand({
      prompt: evalObj.prompt,
      maxTurns: evalObj.max_turns ?? DEFAULT_MAX_TURNS,
      timeoutSec,
      allowedTools: evalObj.allowed_tools,
      args: evalObj.args ?? [],
      pluginDir: opts.pluginDir !== undefined ? join(wt, opts.pluginDir) : undefined,
      cwd: wt,
    });
    const res = spawnSync(bin, argv, {
      cwd: wt,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: env(),
      timeout: timeoutSec * 1000,
      killSignal: 'SIGKILL',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (res.signal === 'SIGINT' || res.signal === 'SIGTERM') interrupted = true;
    if (interrupted) return ['bị dừng giữa chừng'];
    if (res.error) {
      if (res.error.code !== 'ETIMEDOUT') return [`không chạy được ${name}: ${res.error.message}`];
      // Codex/agy have no turn cap: grade the stream captured before the kill instead of discarding it.
      if (adapter.gradePartialOnTimeout) return timeoutChecks(evalObj, adapter.parseEvalStream(res.stdout ?? ''), timeoutSec);
      return [`quá thời gian ${timeoutSec}s`];
    }
    const parsed = adapter.parseEvalStream(res.stdout ?? '');
    // error_max_turns is a normal end of a bounded run: grade what the agent did.
    if (parsed.isError && parsed.subtype !== 'error_max_turns') return [`${name} báo lỗi (exit ${res.status}): ${parsed.result || (res.stderr || '').trim().slice(0, 200) || 'không có kết quả'}`];

    for (const o of outputChecks(evalObj, parsed)) if (!o.pass) failures.push(o.reason);
    for (const check of evalObj.checks) {
      if (check.type !== 'command') continue;
      const expect = check.expect_exit ?? 0;
      const r = spawnSync('sh', ['-c', check.run], { cwd: wt, encoding: 'utf8', env: env() });
      if (r.status !== expect) failures.push(`lệnh "${check.run}" thoát ${r.status}, cần ${expect}`);
    }
    return failures;
  } finally {
    git(root, ['worktree', 'remove', '--force', wt]);
    rmSync(base, { recursive: true, force: true });
  }
}

const tick = () => new Promise((r) => setImmediate(r));

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      only: { type: 'string' },
      'min-pass': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'plugin-dir-from-head': { type: 'string' },
      json: { type: 'boolean', default: false },
      agent: { type: 'string', default: 'claude-code' },
      help: { type: 'boolean', default: false },
    },
  });
  const fail2 = (msg) => {
    process.stderr.write(`${msg}\n`);
    return 2;
  };
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const adapter = getAdapter(values.agent);
  if (!adapter) return fail2(`--agent không hợp lệ: ${values.agent} (chọn: ${ADAPTER_NAMES.join(', ')})`);
  const rawMinPass = values['min-pass'];
  const minPass = rawMinPass === undefined ? 1 : Number(rawMinPass);
  // Number('') and Number(' ') are 0: an empty value would silently accept every run.
  const blank = rawMinPass !== undefined && rawMinPass.trim() === '';
  if (blank || !(minPass >= 0 && minPass <= 1)) return fail2('--min-pass phải nằm trong khoảng 0..1');

  const root = values.root ?? findRoot(process.cwd());
  if (!root) return fail2('Không tìm thấy repo có harness SDLC (thiếu sdlc/config.json).');
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0) return fail2(`${root} không phải git repo.`);

  let loaded = loadEvals(root);
  const invalid = loaded.filter((l) => l.errors.length);
  if (invalid.length) {
    for (const l of invalid) process.stderr.write(`${l.file}: ${l.errors.join('; ')}\n`);
    return 2;
  }
  if (values.only) loaded = loaded.filter((l) => l.eval.name.startsWith(values.only));
  if (loaded.length === 0) return fail2(values.only ? `Không có eval nào khớp "${values.only}".` : 'Không có eval nào trong sdlc/evals.');

  if (values['dry-run']) {
    process.stdout.write(`${loaded.length} eval hợp lệ\n`);
    return 0;
  }

  try {
    if (changedFiles(root).length) process.stderr.write('Cảnh báo: thay đổi chưa commit không được đánh giá (eval chạy trên HEAD).\n');
  } catch {
    // warning is best-effort
  }

  removeStaleWorktrees(root);
  const stop = () => {
    interrupted = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (values['plugin-dir-from-head'] !== undefined && adapter.name !== 'claude-code') process.stderr.write('Cảnh báo: --plugin-dir-from-head chỉ áp dụng cho claude-code, bỏ qua.\n');
  const opts = { pluginDir: adapter.name === 'claude-code' ? values['plugin-dir-from-head'] : undefined };
  const results = [];
  try {
    for (const { eval: e } of loaded) {
      const failures = runOne(root, e, opts, adapter);
      await tick(); // lets a pending SIGINT/SIGTERM handler run
      if (interrupted) break;
      results.push({ name: e.name, pass: failures.length === 0, failures });
    }
  } finally {
    git(root, ['worktree', 'prune']);
  }
  if (interrupted) {
    process.stderr.write('Đã dừng giữa chừng.\n');
    return 130;
  }

  const s = summarize(results);
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ ...s, results })}\n`);
  } else {
    for (const r of results) process.stdout.write(r.pass ? `PASS ${r.name}\n` : `FAIL ${r.name}: ${r.failures.join('; ')}\n`);
    process.stdout.write(`Đạt ${s.passed}/${s.total} (${Math.round(s.rate * 100)}%)\n`);
  }
  return s.rate >= minPass ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 2;
    },
  );
}
