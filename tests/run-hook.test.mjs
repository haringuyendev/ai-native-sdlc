import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, gitInit, progress, runAgent, runHook } from './helpers.mjs';

const cfg = JSON.stringify({ protected_paths: ['secret/**'] });

test('run.mjs matches the legacy pre-edit hook', () => {
  const root = makeRepo({ 'sdlc/config.json': cfg });
  const input = { cwd: root, tool_name: 'Write', tool_input: { file_path: `${root}/secret/x.txt`, content: 'a' } };
  const a = runAgent('claude-code', 'pre-edit', input);
  const b = runHook('pre-edit.mjs', input);
  assert.equal(a.code, 2);
  assert.equal(a.code, b.code);
  assert.equal(a.stderr, b.stderr);
});

test('unknown agent: exit 0, stderr names it, stdout empty', () => {
  const r = runAgent('nope', 'pre-edit', {});
  assert.equal(r.code, 0);
  assert.match(r.stderr, /agent/);
  assert.match(r.stderr, /nope/);
  assert.equal(r.stdout, '');
});

test('handler error: exit 0 with hook lỗi', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'sdlc/changes': 'not a dir' });
  const r = runAgent('claude-code', 'stop', { cwd: root });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /hook lỗi/);
  const bad = runAgent('claude-code', 'pre-edit', 'not json{');
  assert.equal(bad.code, 0);
  assert.match(bad.stderr, /hook lỗi/);
});

test('a throwing render is guarded: stderr hook lỗi, exit 0', async () => {
  const { runAgentHook } = await import('../hooks/run.mjs');
  const stub = { name: 's', displayName: 'S', skillHint: '', parse: () => ({ kind: 'bash', cwd: '/', command: '' }), render: () => { throw new Error('boom'); } };
  const r = await runAgentHook('s', 'pre-bash', '{}', () => stub);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^\[ai-native-sdlc\] hook lỗi, bỏ qua: boom/);
});

test('agy: handler error still exits 0 with {} on stdout', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'sdlc/changes': 'not a dir' });
  const r = runAgent('agy', 'stop', { workspacePaths: [root], executionNum: 0 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '{"decision":"allow"}');
  assert.match(r.stderr, /hook lỗi/);
  const bad = runAgent('agy', 'pre-edit', 'not json{');
  assert.equal(bad.code, 0);
  assert.equal(bad.stdout, '{"decision":"allow"}');
});

test('agy: protected write is denied, others allowed', () => {
  const root = makeRepo({ 'sdlc/config.json': cfg });
  const call = (path) => runAgent('agy', 'pre-edit', { conversationId: 'c', workspacePaths: [root], toolCall: { name: 'write_file', args: { Path: path, Content: 'x' } } });
  const d = call(`${root}/secret/a.txt`);
  assert.equal(d.code, 0);
  assert.equal(d.json.decision, 'deny');
  assert.match(d.json.reason, /protected_paths/);
  assert.deepEqual(call(`${root}/ok.txt`).json, { decision: 'allow' });
});

test('agy: Stop three times in a row continues only on the first (executionNum)', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'sdlc/changes/c1/progress.md': progress('stage: build'), 'src/app.ts': 'v1' });
  gitInit(root);
  writeFileSync(join(root, 'src/app.ts'), 'v2');
  const stop = (n) => runAgent('agy', 'stop', { conversationId: 'conv-1', workspacePaths: [root], executionNum: n });
  const r0 = stop(0);
  assert.equal(r0.json.decision, 'continue');
  assert.match(r0.json.reason, /c1/);
  assert.deepEqual(stop(1).json, { decision: 'allow' });
  assert.deepEqual(stop(2).json, { decision: 'allow' });
});

test('a throwing render falls back to the adapter static allow output', async () => {
  const { runAgentHook } = await import('../hooks/run.mjs');
  const { getAdapter } = await import('../adapters/index.mjs');
  const mk = (allowOutput) => ({ name: 's', displayName: 'S', skillHint: '', parse: () => ({ kind: 'bash', cwd: '/', command: '' }), render: () => { throw new Error('boom'); }, allowOutput });
  const agy = await runAgentHook('s', 'pre-bash', '{}', () => mk(getAdapter('agy').allowOutput));
  assert.equal(agy.stdout, '{"decision":"allow"}');
  assert.equal(agy.code, 0);
  assert.match(agy.stderr, /boom/);
  assert.equal(getAdapter('codex').allowOutput().stdout, '{}');
  assert.equal(getAdapter('claude-code').allowOutput().stdout ?? '', '');
  const bad = await runAgentHook('s', 'pre-bash', '{}', () => mk(() => { throw new Error('x'); }));
  assert.equal(bad.code, 0);
  assert.equal(bad.stdout, '');
});
