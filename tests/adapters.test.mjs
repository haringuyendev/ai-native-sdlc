import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from './helpers.mjs';
import { getAdapter, ADAPTER_NAMES } from '../adapters/index.mjs';

const fx = (n) => JSON.parse(readFileSync(join(PLUGIN_ROOT, 'tests', 'fixtures', 'claude-code', `${n}.json`), 'utf8'));
const cc = getAdapter('claude-code');

test('registry', () => {
  assert.ok(ADAPTER_NAMES.includes('claude-code'));
  assert.equal(getAdapter('nope'), null);
  assert.equal(cc.displayName, 'Claude');
  assert.equal(typeof cc.skillHint, 'string');
});

test('parse pre-edit: write, edit, multiedit', () => {
  const w = fx('write');
  assert.deepEqual(cc.parse('pre-edit', w).files, [{ path: w.tool_input.file_path, newText: w.tool_input.content }]);
  assert.equal(cc.parse('pre-edit', w).kind, 'edit');
  const e = fx('edit');
  assert.equal(cc.parse('pre-edit', e).files[0].newText, 'HELLO');
  const m = fx('multiedit');
  assert.deepEqual(cc.parse('pre-edit', m).files, [{ path: m.tool_input.file_path, newText: 'FOO\nBAR' }]);
});

test('parse bash, session-start, stop', () => {
  const b = fx('bash');
  assert.equal(cc.parse('pre-bash', b).command, b.tool_input.command);
  const s = cc.parse('session-start', fx('session-start'));
  assert.equal(s.kind, 'session-start');
  assert.equal(s.source, 'startup');
  assert.equal(s.cwd, '/repo');
  assert.equal(cc.parse('stop', { stop_hook_active: true }).alreadyContinued, true);
  assert.equal(cc.parse('stop', fx('stop')).alreadyContinued, false);
  assert.equal(cc.parse('stop', fx('stop')).sessionId, fx('stop').session_id);
});

test('R9: handlers do not import adapters', () => {
  const dir = join(PLUGIN_ROOT, 'hooks', 'handlers');
  const files = readdirSync(dir);
  assert.ok(files.length >= 4);
  for (const f of files) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /from '\.\.\/\.\.\/adapters\//, f);
});

test('render', () => {
  assert.deepEqual(cc.render({ type: 'deny', reason: 'r' }), { stderr: 'r\n', code: 2 });
  const ask = cc.render({ type: 'ask', reason: 'r' });
  assert.equal(JSON.parse(ask.stdout).hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(ask.code, 0);
  assert.equal(JSON.parse(cc.render({ type: 'context', text: 't' }).stdout).hookSpecificOutput.additionalContext, 't');
  assert.equal(cc.render({ type: 'continue', reason: 'r' }).stdout, '{"decision":"block","reason":"r"}');
  const allow = cc.render({ type: 'allow' });
  assert.equal(allow.code, 0);
  assert.ok(!allow.stdout);
});

const cfx = (n) => JSON.parse(readFileSync(join(PLUGIN_ROOT, 'tests', 'fixtures', 'codex', `${n}.json`), 'utf8'));
const cx = getAdapter('codex');

test('codex: registered, parse apply_patch with absolute paths and moveTo', () => {
  assert.ok(ADAPTER_NAMES.includes('codex'));
  assert.match(cx.skillHint, /\$<name>/);
  const ev = cx.parse('pre-edit', cfx('apply-patch-multi'));
  assert.equal(ev.kind, 'edit');
  assert.deepEqual(ev.files, [{ path: '/repo/a.txt', newText: 'HELLO' }, { path: '/repo/d.txt', newText: 'added' }]);
  const mv = cx.parse('pre-edit', { cwd: '/r', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: a\n*** Move to: sub/c\n@@\n-a\n+b\n*** Delete File: z\n*** End Patch' } });
  assert.deepEqual(mv.files.map((f) => f.path), ['/r/a', '/r/sub/c', '/r/z']);
  assert.equal(mv.files[2].newText, '');
});

test('codex: parse non-patch edit tool, bash, session, stop', () => {
  assert.equal(cx.parse('pre-edit', { cwd: '/r', tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
  assert.equal(cx.parse('pre-bash', cfx('bash')).command, 'echo first');
  assert.equal(cx.parse('session-start', cfx('session-start')).kind, 'session-start');
  assert.equal(cx.parse('stop', cfx('stop-active')).alreadyContinued, true);
});

test('codex: render', () => {
  assert.deepEqual(cx.render({ type: 'deny', reason: 'r' }), cc.render({ type: 'deny', reason: 'r' }));
  assert.deepEqual(cx.render({ type: 'context', text: 't' }), cc.render({ type: 'context', text: 't' }));
  assert.deepEqual(cx.render({ type: 'continue', reason: 'r' }), cc.render({ type: 'continue', reason: 'r' }));
  assert.deepEqual(cx.render({ type: 'ask', reason: 'R.' }), { stderr: 'R. Codex không hỏi được ở bước này: hãy để người dùng tự chạy lệnh.\n', code: 2 });
  assert.deepEqual(cx.render({ type: 'allow' }), { stdout: '{}', code: 0 });
});

test('codex pre-bash: rules file must exist and be in sync; every matching gate must be covered', async () => {
  const { runAgent, makeRepo } = await import('./helpers.mjs');
  const { renderRules, RULES_PATH } = await import('../lib/codex-rules.mjs');
  const gates = [
    { pattern: '\\bpush\\b', reason: 'R.', prefixes: [['git', 'push', '-f']] },
    { pattern: '\\bdeploy\\b', reason: 'D.' },
  ];
  const cfg = JSON.stringify({ gates });
  const { realpathSync, writeFileSync } = await import('node:fs');
  // Every repo below is trusted in Codex; the untrusted case is its own test.
  const home = makeRepo();
  const trust = (root) => {
    writeFileSync(join(home, 'config.toml'), `[projects."${realpathSync(root)}"]\ntrust_level = "trusted"\n`, { flag: 'a' });
    return root;
  };
  const run = (root, command) => runAgent('codex', 'pre-bash', { cwd: trust(root), tool_input: { command } }, { CODEX_HOME: home });
  const missing = makeRepo({ 'sdlc/config.json': cfg });
  const r1 = run(missing, 'git push -f origin x');
  assert.equal(r1.code, 2);
  assert.match(r1.stderr, /sync-agent-files\.mjs/);
  const stale = makeRepo({ 'sdlc/config.json': cfg, [RULES_PATH]: '# old\n' });
  assert.equal(run(stale, 'git push -f origin x').code, 2);
  const ok = makeRepo({ 'sdlc/config.json': cfg, [RULES_PATH]: renderRules(gates) });
  assert.equal(run(ok, 'git push -f origin x').code, 0);
  assert.equal(run(ok, 'git push origin +x').code, 2);
  const mixed = run(ok, 'git push -f x; deploy prod');
  assert.equal(mixed.code, 2);
  assert.match(mixed.stderr, /D\./);
});

test('codex pre-bash: a gate in a project Codex does not trust is denied (rules are ignored there)', async () => {
  const { runAgent, makeRepo } = await import('./helpers.mjs');
  const { renderRules, RULES_PATH } = await import('../lib/codex-rules.mjs');
  const gates = [{ pattern: '\\bpush\\b', reason: 'R.', prefixes: [['git', 'push', '-f']] }];
  const root = makeRepo({ 'sdlc/config.json': JSON.stringify({ gates }), [RULES_PATH]: renderRules(gates) });
  const r = runAgent('codex', 'pre-bash', { cwd: root, tool_input: { command: 'git push -f origin x' } }, { CODEX_HOME: makeRepo() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /trust/);
  const plain = runAgent('codex', 'pre-bash', { cwd: root, tool_input: { command: 'git status' } }, { CODEX_HOME: makeRepo() });
  assert.equal(plain.code, 0);
});

test('codex: Claude-shaped Write falls back to claude parse and is guarded', async () => {
  const { runAgent, makeRepo } = await import('./helpers.mjs');
  const root = makeRepo({ 'sdlc/config.json': '{"protected_paths":["secret/**"]}' });
  const r = runAgent('codex', 'pre-edit', { cwd: root, tool_name: 'Write', tool_input: { file_path: `${root}/secret/a.txt`, content: 'x' } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /protected_paths/);
});

test('codex: patch paths outside the repo or with .. are allowed without crashing', async () => {
  const { runAgent, makeRepo } = await import('./helpers.mjs');
  const root = makeRepo({ 'sdlc/config.json': '{"protected_paths":["secret/**"]}' });
  const command = '*** Begin Patch\n*** Add File: /etc/ai-native-sdlc-x\n+a\n*** Add File: ../x\n+b\n*** End Patch';
  const r = runAgent('codex', 'pre-edit', { cwd: root, tool_name: 'apply_patch', tool_input: { command } });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '{}');
});

const afx = (n) => JSON.parse(readFileSync(join(PLUGIN_ROOT, 'tests', 'fixtures', 'agy', `${n}.json`), 'utf8'));
const agy = getAdapter('agy');

test('agy: registered with metadata', () => {
  assert.ok(ADAPTER_NAMES.includes('agy'));
  assert.equal(agy.displayName, 'Antigravity');
  assert.equal(agy.skillHint, 'For all other skills, use /<name> (skills are slash commands).');
});

test('agy: parse run_command, cwd from Cwd or workspacePaths[0]', () => {
  const b = agy.parse('pre-bash', afx('run-command'));
  assert.equal(b.kind, 'bash');
  assert.equal(b.command, 'echo first');
  assert.equal(b.cwd, '/repo');
  assert.equal(b.sessionId, afx('run-command').conversationId);
  const withCwd = structuredClone(afx('run-command'));
  withCwd.toolCall.args.Cwd = '/repo/sub';
  assert.equal(agy.parse('pre-bash', withCwd).cwd, '/repo/sub');
});

test('agy: parse write_file and edit_file', () => {
  const w = agy.parse('pre-edit', afx('write-file'));
  assert.equal(w.kind, 'edit');
  assert.deepEqual(w.files, [{ path: '/repo/n.txt', newText: 'new' }]);
  assert.equal(w.cwd, '/repo');
  assert.deepEqual(agy.parse('pre-edit', afx('edit-file')).files, [{ path: '/repo/a.txt', newText: 'HELLO' }]);
  assert.equal(agy.parse('pre-edit', afx('run-command')), null);
});

test('agy: parse session-start and stop (alreadyContinued = executionNum > 0)', () => {
  const s = agy.parse('session-start', afx('session-start'));
  assert.equal(s.kind, 'session-start');
  assert.equal(s.cwd, '/repo');
  assert.equal(agy.parse('stop', afx('stop')).alreadyContinued, false);
  assert.equal(agy.parse('stop', afx('stop-after-continue')).alreadyContinued, true);
  assert.equal(agy.parse('stop', afx('stop')).sessionId, afx('stop').conversationId);
});

test('agy: render', () => {
  assert.deepEqual(agy.render({ type: 'deny', reason: 'r' }), { stdout: '{"decision":"deny","reason":"r"}', code: 0 });
  assert.deepEqual(agy.render({ type: 'ask', reason: 'r' }), { stdout: '{"decision":"ask","reason":"r"}', code: 0 });
  assert.deepEqual(agy.render({ type: 'context', text: 't' }), { stdout: '{"injectSteps":[{"systemMessage":{"systemMessage":"t"}}]}', code: 0 });
  assert.deepEqual(agy.render({ type: 'continue', reason: 'r' }), { stdout: '{"decision":"continue","reason":"r"}', code: 0 });
  assert.deepEqual(agy.render({ type: 'allow' }), { stdout: '{"decision":"allow"}', code: 0 });
});
