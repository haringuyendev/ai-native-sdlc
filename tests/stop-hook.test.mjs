import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, existsSync, readFileSync, mkdirSync, rmSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { makeRepo, gitInit, progress, runHook, runAgent } from './helpers.mjs';

function repo(stage = 'build', config = '{}') {
  const root = makeRepo({
    'sdlc/config.json': config,
    'sdlc/changes/c1/progress.md': progress(`stage: ${stage}`),
    'src/app.ts': 'v1',
  });
  gitInit(root);
  return root;
}

const stop = (root, extra = {}) => runHook('stop.mjs', { cwd: root, hook_event_name: 'Stop', stop_hook_active: false, ...extra });

test('blocks once when code changed but progress.md did not', () => {
  const root = repo();
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r = stop(root);
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /c1/);
});

test('allows when progress.md was updated too', () => {
  const root = repo('build', '{"format_check": false}'); // minimal frontmatter fixture, not a format test
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  writeFileSync(join(root, 'sdlc/changes/c1/progress.md'), progress('stage: build', '## Log\n### 2026-10-20 — Hải\n'));
  const r = stop(root);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('never blocks twice in a row', () => {
  const root = repo();
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r = stop(root, { stop_hook_active: true });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('ignores changes outside build/review', () => {
  const root = repo('spec');
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r = stop(root);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('respects handoff_log: false', () => {
  const root = repo('build', '{"handoff_log": false}');
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r = stop(root);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('clean tree -> no block', () => {
  const r = stop(repo());
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

const git = (root, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root });
function session(root) {
  const env = { AI_SDLC_STATE_DIR: mkdtempSync(join(tmpdir(), 'sdlc-state-')) };
  const id = 's-' + Math.random().toString(36).slice(2);
  const r = runHook('session-start.mjs', { cwd: root, session_id: id, hook_event_name: 'SessionStart' }, env);
  assert.equal(r.code, 0);
  return { env, id };
}
const stopIn = (root, s) => runHook('stop.mjs', { cwd: root, session_id: s.id, hook_event_name: 'Stop', stop_hook_active: false }, s.env);

test('baseline: code committed in the session without a log entry blocks', () => {
  const root = repo();
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  git(root, 'commit', '-qam', 'code');
  const r = stopIn(root, s);
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'block');
});

test('baseline: a file dirty before the session does not block a quiet turn', () => {
  const root = repo();
  writeFileSync(join(root, 'src/app.ts'), 'dirty before');
  const s = session(root);
  const r = stopIn(root, s);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('baseline: code and a log entry committed in the session do not block', () => {
  const root = repo('build', '{"format_check": false}'); // minimal frontmatter fixture, not a format test
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  writeFileSync(join(root, 'sdlc/changes/c1/progress.md'), progress('stage: build', '## Log\n### 2026-10-21 — Hải\n'));
  git(root, 'commit', '-qam', 'work and log');
  const r = stopIn(root, s);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('baseline: progress.md dirty before the session and edited again counts as logged', () => {
  const root = repo('build', '{"format_check": false}'); // minimal frontmatter fixture, not a format test
  writeFileSync(join(root, 'sdlc/changes/c1/progress.md'), progress('stage: build', '## Log\n### old\n'));
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  writeFileSync(join(root, 'sdlc/changes/c1/progress.md'), progress('stage: build', '## Log\n### old\n### 2026-10-21 — Hải\n'));
  const r = stopIn(root, s);
  assert.equal(r.json, null);
});

test('session-start writes a baseline only inside a harness repo', () => {
  const root = repo();
  const s = session(root);
  assert.ok(existsSync(join(s.env.AI_SDLC_STATE_DIR, `${s.id}.json`)));
  const env = { AI_SDLC_STATE_DIR: mkdtempSync(join(tmpdir(), 'sdlc-state-')) };
  const r = runHook('session-start.mjs', { cwd: makeRepo(), session_id: 'x' }, env);
  assert.equal(r.code, 0);
  assert.equal(existsSync(join(env.AI_SDLC_STATE_DIR, 'x.json')), false);
});

test('baseline: an unknown baseline head stays quiet and still blocks on newly dirty code', () => {
  const root = repo();
  const s = session(root);
  const f = join(s.env.AI_SDLC_STATE_DIR, `${s.id}.json`);
  const b = JSON.parse(readFileSync(f, 'utf8'));
  b.head = '0123456789abcdef0123456789abcdef01234567';
  writeFileSync(f, JSON.stringify(b));
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r = stopIn(root, s);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json.decision, 'block');
});

test('baseline: a baseline head that is no longer an ancestor is ignored', () => {
  const root = repo();
  writeFileSync(join(root, 'extra.txt'), 'x');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'extra');
  const s = session(root);
  git(root, 'reset', '-q', '--hard', 'HEAD~1');
  mkdirSync(join(root, 'sdlc/changes/c1'), { recursive: true });
  writeFileSync(join(root, 'sdlc/changes/c1/notes.md'), 'n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'notes');
  const r = stopIn(root, s);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

const sessionFile = (s) => join(s.env.AI_SDLC_STATE_DIR, `${s.id}.json`);
const startAgain = (root, s, source) =>
  runHook('session-start.mjs', { cwd: root, session_id: s.id, hook_event_name: 'SessionStart', source }, s.env);

test('G1 compact keeps the baseline; startup replaces it', () => {
  const root = repo();
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  assert.equal(startAgain(root, s, 'compact').code, 0);
  assert.equal(stopIn(root, s).json.decision, 'block');
  assert.equal(startAgain(root, s, 'startup').code, 0);
  const r = stopIn(root, s);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('G2 a file dirty before the session and edited again counts as touched', () => {
  const root = repo();
  writeFileSync(join(root, 'src/app.ts'), 'dirty before');
  const s = session(root);
  assert.equal(stopIn(root, s).json, null);
  writeFileSync(join(root, 'src/app.ts'), 'dirty before, edited in session');
  const r = stopIn(root, s);
  assert.equal(r.stderr, '');
  assert.equal(r.json.decision, 'block');
});

test('G2 a file dirty before the session and deleted counts as touched', () => {
  const root = repo();
  writeFileSync(join(root, 'src/app.ts'), 'dirty before');
  const s = session(root);
  rmSync(join(root, 'src/app.ts'));
  assert.equal(stopIn(root, s).json.decision, 'block');
});

test('G3 reminds once per touched set', () => {
  const root = repo();
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  assert.equal(stopIn(root, s).json.decision, 'block');
  const again = stopIn(root, s);
  assert.equal(again.code, 0);
  assert.equal(again.stderr, '');
  assert.equal(again.json, null);
  writeFileSync(join(root, 'src/other.ts'), 'new');
  assert.equal(stopIn(root, s).json.decision, 'block');
  assert.equal(stopIn(root, s).json, null);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'more');
  assert.equal(stopIn(root, s).json.decision, 'block');
});

test('G4 state dir is pruned of old files and keeps fresh ones', () => {
  const root = repo();
  const s = session(root);
  const dir = s.env.AI_SDLC_STATE_DIR;
  const old = join(dir, 'old.json');
  const fresh = join(dir, 'fresh.json');
  const stale = new Date(Date.now() - 15 * 86400000);
  writeFileSync(old, '{}');
  writeFileSync(fresh, '{}');
  utimesSync(old, stale, stale);
  startAgain(root, s, 'startup');
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(statSync(sessionFile(s)).mode & 0o777, 0o600);
});

test('G5 baseline head null at session start (no commits) then commit code blocks', () => {
  const root = makeRepo({
    'sdlc/config.json': '{}',
    'sdlc/changes/c1/progress.md': progress('stage: build'),
  });
  execFileSync('git', ['init', '-q'], { cwd: root });
  const s = session(root);
  assert.equal(JSON.parse(readFileSync(sessionFile(s), 'utf8')).head, null);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/app.ts'), 'v1');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  const r = stopIn(root, s);
  assert.equal(r.stderr, '');
  assert.equal(r.json.decision, 'block');
});

test('G5 stop_hook_active with a baseline does not block', () => {
  const root = repo();
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r = runHook('stop.mjs', { cwd: root, session_id: s.id, stop_hook_active: true }, s.env);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('G5 baseline from a different root falls back to the git-status rule', () => {
  const root = repo();
  writeFileSync(join(root, 'src/app.ts'), 'dirty before');
  const s = session(root);
  const b = JSON.parse(readFileSync(sessionFile(s), 'utf8'));
  b.root = '/somewhere/else';
  writeFileSync(sessionFile(s), JSON.stringify(b));
  const r = stopIn(root, s);
  assert.equal(r.stderr, '');
  assert.equal(r.json.decision, 'block');
});

// --- R6: artifact format check on Stop ---
const GOOD_FM = (stage) =>
  `change: c1\ntitle: T\nowner: Hải\nstage: ${stage}\nnext: x\nblocked_by:\ntest_lock: false\napprovals:\n  intent: { by: Hải, at: 2026-10-20 }\n  spec: { by: Hải, at: 2026-10-20 }\nlinks: {}`;
const GOOD_LOG = '## Log\n### 2026-10-20 — Hải + Claude\n- ok\n';
const BAD_LOG = '## Log\n### 2026-10-20 Hải\n- ok\n';
const sec = (...hs) => hs.map((h) => `${h}\n\ntext\n`).join('\n');
function fmtRepo(stage = 'build', config = '{}') {
  const root = makeRepo({
    'sdlc/config.json': config,
    'sdlc/changes/c1/progress.md': progress(GOOD_FM(stage), GOOD_LOG),
    'sdlc/changes/c1/intent.md': sec('## Problem', '## Proposed outcome', '## Affected users and systems', '## Constraints', '## Open questions'),
    'sdlc/changes/c1/spec.md': sec('## Requirements', '## Design', '## Policies applied', '## Flagged concerns', '## Answers to open questions', '## Out of scope'),
    'sdlc/changes/c1/plan.md': sec('## Files that change', '## Order of work', '## Risks', '## Proof'),
    'src/app.ts': 'v1',
  });
  gitInit(root);
  return root;
}
const breakProgress = (root, stage = 'build') => writeFileSync(join(root, 'sdlc/changes/c1/progress.md'), progress(GOOD_FM(stage), BAD_LOG));

test('format: a malformed progress.md touched in the session blocks with the errors', () => {
  const root = fmtRepo();
  const s = session(root);
  breakProgress(root);
  const r = stopIn(root, s);
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /progress\.md:\d+/);
  assert.match(r.json.reason, /Log/);
});

test('format: a valid touched change does not block', () => {
  const root = fmtRepo();
  const s = session(root);
  writeFileSync(join(root, 'sdlc/changes/c1/progress.md'), progress(GOOD_FM('build'), GOOD_LOG + '- more\n'));
  const r = stopIn(root, s);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('format: stop_hook_active with remaining errors allows and reports on stderr', () => {
  const root = fmtRepo();
  const s = session(root);
  breakProgress(root);
  const r = runHook('stop.mjs', { cwd: root, session_id: s.id, stop_hook_active: true }, s.env);
  assert.equal(r.code, 0);
  assert.equal(r.json, null);
  assert.match(r.stderr, /Log/);
});

test('format: format_check false skips the check', () => {
  const root = fmtRepo('build', '{"format_check": false}');
  const s = session(root);
  breakProgress(root);
  const r = stopIn(root, s);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('format: a done change touched is not checked', () => {
  const root = fmtRepo('done');
  const s = session(root);
  breakProgress(root, 'done');
  const r = stopIn(root, s);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

test('format: an untouched malformed change is not checked', () => {
  const root = fmtRepo();
  breakProgress(root);
  git(root, 'commit', '-qam', 'bad before session');
  const s = session(root);
  const r = stopIn(root, s);
  assert.equal(r.json, null);
});

test('format: the handoff reminder takes priority over format errors', () => {
  const root = fmtRepo();
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  writeFileSync(join(root, 'sdlc/changes/c1/plan.md'), 'no headings\n');
  const r = stopIn(root, s);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /Trước khi dừng/);
});

test('handoff reminder names the agent: + Codex under --agent codex', () => {
  const root = fmtRepo();
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r = runAgent('codex', 'stop', { cwd: root, session_id: 'cx', hook_event_name: 'Stop' });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\+ Codex/);
});

// --- review fix: format check gets its own hold after the handoff reminder ---
const agyStart = (root, s) => runAgent('agy', 'session-start', { conversationId: s.id, workspacePaths: [root] }, s.env);
const agyStop = (root, s, n) => runAgent('agy', 'stop', { conversationId: s.id, workspacePaths: [root], executionNum: n }, s.env);
const claudeStop = (root, s, active) => runHook('stop.mjs', { cwd: root, session_id: s.id, hook_event_name: 'Stop', stop_hook_active: active }, s.env);

test('format: a malformed Log written after the handoff reminder is held once (claude shape)', () => {
  const root = fmtRepo();
  const s = session(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r1 = claudeStop(root, s, false);
  assert.equal(r1.json.decision, 'block');
  assert.match(r1.json.reason, /Trước khi dừng/);
  breakProgress(root);
  const r2 = claudeStop(root, s, true);
  assert.equal(r2.json.decision, 'block');
  assert.match(r2.json.reason, /progress\.md:\d+/);
  const r3 = claudeStop(root, s, true);
  assert.equal(r3.json, null);
  assert.match(r3.stderr, /Log/);
});

test('format: a malformed Log written after the handoff reminder is held once (agy shape)', () => {
  const root = fmtRepo();
  const s = { env: { AI_SDLC_STATE_DIR: mkdtempSync(join(tmpdir(), 'sdlc-state-')) }, id: 'conv-fmt' };
  assert.equal(agyStart(root, s).code, 0);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const r1 = agyStop(root, s, 0);
  assert.equal(r1.json.decision, 'continue');
  assert.match(r1.json.reason, /Trước khi dừng/);
  breakProgress(root);
  const r2 = agyStop(root, s, 1);
  assert.equal(r2.json.decision, 'continue');
  assert.match(r2.json.reason, /progress\.md:\d+/);
  assert.deepEqual(agyStop(root, s, 2).json, { decision: 'allow' });
});

test('format: a format hold on the first stop is not repeated on the next stop', () => {
  const root = fmtRepo();
  const s = session(root);
  breakProgress(root);
  assert.equal(claudeStop(root, s, false).json.decision, 'block');
  assert.equal(claudeStop(root, s, true).json, null);
});
