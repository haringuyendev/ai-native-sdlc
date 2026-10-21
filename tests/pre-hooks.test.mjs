import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeRepo, progress, runHook } from './helpers.mjs';

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
