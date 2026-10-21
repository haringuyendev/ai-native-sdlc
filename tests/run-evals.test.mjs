import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { PLUGIN_ROOT, makeRepo, gitInit } from './helpers.mjs';

const SCRIPT = join(PLUGIN_ROOT, 'scripts', 'run-evals.mjs');

function fakeClaude() {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-fake-'));
  const file = join(dir, 'claude');
  writeFileSync(
    file,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const prompt = process.argv[3];
writeFileSync('prompt.txt', prompt);
writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));
writeFileSync('env.json', JSON.stringify(process.env));
const skill = (s) => console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: s } }] } }));
const result = (o) => console.log(JSON.stringify({ type: 'result', ...o }));
console.log('banner: not json');
if (prompt.includes('ý tưởng')) skill('ai-native-sdlc:intent');
if (prompt.includes('plan')) skill('ai-native-sdlc:plan');
if (prompt.includes('ngắt')) process.kill(process.ppid, 'SIGINT');
const finish = () => {
  if (prompt.includes('hết lượt')) result({ subtype: 'error_max_turns', is_error: true });
  else if (prompt.includes('lỗi chạy')) result({ subtype: 'error_during_execution', is_error: true });
  else result({ subtype: 'success', result: 'xong', is_error: false });
};
if (prompt.includes('chậm')) setTimeout(finish, 5000); else finish();
`,
  );
  chmodSync(file, 0o755);
  return file;
}

const FAKE = fakeClaude();

const ev = (name, extra = {}) => ({
  name,
  description: name,
  source: 'task',
  prompt: 'ý tưởng mới',
  checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:intent' }],
  ...extra,
});

function evalRepo(evals, raw = {}) {
  const files = { 'sdlc/config.json': '{}' };
  for (const e of evals) files[`sdlc/evals/${e.name}.json`] = JSON.stringify(e);
  Object.assign(files, raw);
  const root = makeRepo(files);
  gitInit(root);
  return root;
}

function run(root, flags = [], env = {}) {
  const e = { ...process.env, AI_SDLC_CLAUDE_BIN: FAKE, ...env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete e[k];
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...flags], { encoding: 'utf8', env: e });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const worktrees = (root) =>
  execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.startsWith('worktree ')).length;

const okEval = () => ev('ok', { checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:intent' }, { type: 'command', run: 'test -f prompt.txt' }] });
const badEval = () => ev('bad', { checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:spec' }] });

test('passing eval runs in a throwaway worktree', () => {
  const root = evalRepo([okEval()]);
  const r = run(root);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PASS ok/);
  assert.match(r.stdout, /Đạt 1\/1 \(100%\)/);
  assert.equal(existsSync(join(root, 'prompt.txt')), false);
  assert.equal(worktrees(root), 1);
});

test('failing eval exits 1 and names the reason', () => {
  const root = evalRepo([okEval(), badEval()]);
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL bad:/);
  assert.match(r.stdout, /đầu tiên là intent, cần ai-native-sdlc:spec/);
});

test('--min-pass 0.5 accepts one of two', () => {
  const root = evalRepo([okEval(), badEval()]);
  assert.equal(run(root, ['--min-pass', '0.5']).code, 0);
});

test('--only filters by prefix', () => {
  const root = evalRepo([okEval(), badEval()]);
  const r = run(root, ['--only', 'ok']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Đạt 1\/1/);
});

test('--json prints the summary only', () => {
  const root = evalRepo([okEval(), badEval()]);
  const r = run(root, ['--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.total, 2);
  assert.equal(out.passed, 1);
  assert.ok(out.results.find((x) => x.name === 'bad').failures.length > 0);
});

test('prompt reaches claude verbatim', () => {
  const e = ev('verbatim', {
    prompt: 'ý tưởng "x" $(echo hi)\ndòng 2',
    checks: [{ type: 'command', run: "grep -qF '$(echo hi)' prompt.txt" }],
  });
  const root = evalRepo([e]);
  const r = run(root);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /PASS verbatim/);
});

test('missing claude binary fails the eval, not the run', () => {
  const root = evalRepo([okEval(), ev('second')]);
  const r = run(root, [], { AI_SDLC_CLAUDE_BIN: '/nonexistent' });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /không chạy được claude/);
  assert.match(r.stdout, /FAIL second/);
  assert.equal(worktrees(root), 1);
});

test('timeout fails the eval', () => {
  const root = evalRepo([ev('slow', { prompt: 'chậm', timeout_sec: 1 })]);
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /quá thời gian 1s/);
  assert.equal(worktrees(root), 1);
});

test('error_max_turns is a normal end and is graded', () => {
  const root = evalRepo([ev('turns', { prompt: 'ý tưởng hết lượt' }), ev('crash', { prompt: 'ý tưởng lỗi chạy' })]);
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /PASS turns/);
  assert.match(r.stdout, /FAIL crash: claude báo lỗi/);
});

// node -e assertion over the argv the fake claude dumped in the eval worktree
const argvCheck = (expr) => ({ type: 'command', run: `node -e "const a=require('./argv.json');const at=(f)=>a[a.indexOf(f)+1];process.exit((${expr})?0:1)"` });

test('allowed_tools restricts the tool set and permission mode is dontAsk', () => {
  const e = ev('tools', {
    allowed_tools: 'Read,Edit,Bash(npm test),Bash(git status)',
    args: ['--extra'],
    checks: [
      argvCheck("at('--tools')==='Read,Edit,Bash'"),
      argvCheck("at('--allowedTools')==='Read,Edit,Bash(npm test),Bash(git status)'"),
      argvCheck("at('--permission-mode')==='dontAsk'&&a.indexOf('--permission-mode')<a.indexOf('--extra')"),
    ],
  });
  const r = run(evalRepo([e]));
  assert.equal(r.code, 0, r.stdout);
  const plain = ev('plain', { checks: [argvCheck("!a.includes('--tools')&&at('--permission-mode')==='dontAsk'&&!a.includes('--plugin-dir')")] });
  assert.equal(run(evalRepo([plain])).code, 0);
});

test('--plugin-dir-from-head loads the plugin from the eval worktree', () => {
  const e = ev('plugdir', {
    checks: [argvCheck("at('--plugin-dir').endsWith('/wt')&&require('fs').realpathSync(at('--plugin-dir'))===process.cwd()")],
  });
  const r = run(evalRepo([e]), ['--plugin-dir-from-head', '.']);
  assert.equal(r.code, 0, r.stdout);
  const sub = ev('plugsub', { checks: [argvCheck("at('--plugin-dir').endsWith('/wt/plugin')")] });
  assert.equal(run(evalRepo([sub]), ['--plugin-dir-from-head', 'plugin']).code, 0);
});

test('stale eval worktrees from an earlier run are removed', () => {
  const root = evalRepo([okEval()]);
  const stale = join(mkdtempSync(join(tmpdir(), 'sdlc-eval-')), 'wt');
  execFileSync('git', ['worktree', 'add', '--detach', '-q', stale, 'HEAD'], { cwd: root });
  assert.equal(worktrees(root), 2);
  const r = run(root);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(worktrees(root), 1);
  assert.equal(existsSync(stale), false);
});

test('SIGINT stops the run, cleans up and exits 130', () => {
  const root = evalRepo([ev('a-stop', { prompt: 'ý tưởng ngắt' }), ev('b-next')]);
  const r = run(root);
  assert.equal(r.code, 130, r.stdout + r.stderr);
  assert.match(r.stderr, /Đã dừng giữa chừng\./);
  assert.doesNotMatch(r.stdout, /b-next/);
  assert.equal(worktrees(root), 1);
});

test('invalid eval exits 2', () => {
  const root = evalRepo([okEval()], { 'sdlc/evals/x.json': '{}' });
  const r = run(root);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /x\.json/);
});

test('--min-pass that is not a number in 0..1 exits 2', () => {
  const root = evalRepo([okEval()]);
  for (const v of ['', ' ', 'abc', '1.5', '-0.1']) {
    const r = run(root, [`--min-pass=${v}`]);
    assert.equal(r.code, 2, `--min-pass=${JSON.stringify(v)}`);
    assert.match(r.stderr, /--min-pass/);
  }
});

test('parent Claude session variables do not reach the eval claude', () => {
  const e = ev('envcheck', {
    checks: [{ type: 'command', run: `node -e "const e=require('./env.json');process.exit(Object.keys(e).some((k)=>k==='CLAUDE_CODE_SESSION_ID'||k.startsWith('CLAUDE_CODE_MESSAGING_'))?1:0)"` }],
  });
  const r = run(evalRepo([e]), [], { CLAUDE_CODE_SESSION_ID: 'parent', CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/x' });
  assert.equal(r.code, 0, r.stdout);
});

test('no evals exits 2', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}' });
  gitInit(root);
  assert.equal(run(root).code, 2);
  const root2 = evalRepo([okEval()]);
  const r = run(root2, ['--only', 'zzz']);
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.stdout, /Đạt/);
});

test('--dry-run validates without calling claude', () => {
  const root = evalRepo([okEval()]);
  const r = run(root, ['--dry-run'], { AI_SDLC_CLAUDE_BIN: '/nonexistent' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '1 eval hợp lệ');
});

test('dirty tree warns', () => {
  const root = evalRepo([okEval()]);
  writeFileSync(join(root, 'dirty.txt'), 'x');
  const r = run(root);
  assert.match(r.stderr, /chưa commit/);
});
