import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT, makeRepo, progress, runAgent, runHook } from './helpers.mjs';

const CONFIG = JSON.stringify({
  protected_paths: ['src/gen/**'],
  gates: [{ pattern: 'deploy.*prod', reason: 'Cần release manager duyệt' }],
});

function repo(extra = {}) {
  return makeRepo({ 'sdlc/config.json': CONFIG, ...extra });
}

const edit = (root, file, content = 'x') => ({
  cwd: root,
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  tool_input: { file_path: join(root, file), content },
});

test('pre-edit allows ordinary edits', () => {
  const r = runHook('pre-edit.mjs', edit(repo(), 'src/app.ts'));
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('pre-edit blocks protected paths with exit 2', () => {
  const r = runHook('pre-edit.mjs', edit(repo(), 'src/gen/a.ts'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /protected_paths/);
});

test('pre-edit blocks test files when an open change has test_lock', () => {
  const root = repo({ 'sdlc/changes/fix/progress.md': progress('stage: build\ntest_lock: true') });
  const r = runHook('pre-edit.mjs', edit(root, 'src/a.test.ts'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /test_lock/);
});

test('pre-edit ignores test_lock on closed changes', () => {
  const root = repo({ 'sdlc/changes/fix/progress.md': progress('stage: done\ntest_lock: true') });
  const r = runHook('pre-edit.mjs', edit(root, 'src/a.test.ts'));
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('pre-edit blocks secrets', () => {
  const r = runHook('pre-edit.mjs', edit(repo(), 'src/k.ts', 'const k = "AKIA' + 'ABCDEFGHIJKLMNOP";'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWS/);
});

test('pre-edit allows secrets in secret_allow paths', () => {
  const root = makeRepo({ 'sdlc/config.json': JSON.stringify({ secret_allow: ['docs/**'] }) });
  const r = runHook('pre-edit.mjs', edit(root, 'docs/k.md', 'AKIA' + 'ABCDEFGHIJKLMNOP'));
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('pre-edit is a no-op without a harness', () => {
  const root = makeRepo({ 'src/gen/a.ts': '' });
  const r = runHook('pre-edit.mjs', edit(root, 'src/gen/a.ts'));
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('pre-edit survives broken config', () => {
  const root = makeRepo({ 'sdlc/config.json': '{oops' });
  const r = runHook('pre-edit.mjs', edit(root, 'src/gen/a.ts'));
  assert.equal(r.code, 0);
  assert.match(r.stderr, /config\.json/);
});

test('pre-bash asks for gated commands', () => {
  const r = runHook('pre-bash.mjs', { cwd: repo(), tool_name: 'Bash', tool_input: { command: './deploy.sh production' } });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /release manager/);
});

test('pre-bash stays silent for other commands', () => {
  const r = runHook('pre-bash.mjs', { cwd: repo(), tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.json, null);
});

const TOKEN = 'const k = "AKIA' + 'ABCDEFGHIJKLMNOP";';
const tpl = readFileSync(join(PLUGIN_ROOT, 'templates', 'config.json'), 'utf8');

test('pre-edit skips the secret scan when secret_scan is false', () => {
  const root = makeRepo({ 'sdlc/config.json': JSON.stringify({ secret_scan: false }) });
  assert.equal(runHook('pre-edit.mjs', edit(root, 'src/k.ts', TOKEN)).code, 0);
});

test('pre-edit still scans when secret_scan is anything but false', () => {
  for (const v of ['false', 0, true]) {
    const root = makeRepo({ 'sdlc/config.json': JSON.stringify({ secret_scan: v }) });
    assert.equal(runHook('pre-edit.mjs', edit(root, 'src/k.ts', TOKEN)).code, 2, String(v));
  }
});

test('secret_scan false keeps protected_paths and test_lock', () => {
  const root = makeRepo({
    'sdlc/config.json': JSON.stringify({ secret_scan: false, protected_paths: ['src/gen/**'] }),
    'sdlc/changes/fix/progress.md': progress('stage: build\ntest_lock: true'),
  });
  assert.equal(runHook('pre-edit.mjs', edit(root, 'src/gen/a.ts')).code, 2);
  assert.equal(runHook('pre-edit.mjs', edit(root, 'src/a.test.ts')).code, 2);
});

test('init template config lets secrets and force push through on every agent', () => {
  const root = makeRepo({ 'sdlc/config.json': tpl });
  assert.equal(runHook('pre-edit.mjs', edit(root, 'src/k.ts', TOKEN)).code, 0);
  const bash = { cwd: root, tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } };
  assert.equal(runHook('pre-bash.mjs', bash).json, null);
  const codex = runAgent('codex', 'pre-bash', { cwd: root, tool_input: { command: 'git push --force origin main' } });
  assert.equal(codex.code, 0);
  assert.doesNotMatch(codex.stdout, /deny/);
});

test('init template keeps handoff_log and format_check on', () => {
  const cfg = JSON.parse(tpl);
  assert.equal(cfg.handoff_log, true);
  assert.equal(cfg.format_check, true);
});
