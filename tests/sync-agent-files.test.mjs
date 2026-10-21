import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { makeRepo, PLUGIN_ROOT } from './helpers.mjs';

const SCRIPT = join(PLUGIN_ROOT, 'scripts', 'sync-agent-files.mjs');
const GATED = JSON.stringify({ gates: [{ pattern: 'x', reason: 'r', prefixes: [['git', 'push', '--force']] }] });
const RULES = '.codex/rules/ai-native-sdlc.rules';
const sync = (root, args = [], input = '') =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, input, encoding: 'utf8' });
const rd = (root, p) => readFileSync(join(root, p), 'utf8');

test('--yes on a fresh repo creates AGENTS.md, CLAUDE.md, rules and three verifiers', () => {
  const root = makeRepo({ 'sdlc/config.json': GATED });
  const r = sync(root, ['--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rd(root, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.ok(rd(root, 'AGENTS.md').includes('## Things agents get wrong'));
  assert.match(rd(root, RULES), /prefix_rule/);
  for (const p of ['.claude/agents/verifier.md', '.codex/agents/verifier.toml', '.agents/agents/verifier.md']) {
    assert.ok(existsSync(join(root, p)), p);
  }
});

test('existing CLAUDE.md without AGENTS.md: dry-run shows the move and writes nothing', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'CLAUDE.md': '# Mine\nline two\n' });
  const r = sync(root, ['--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^\+# Mine$/m);
  assert.match(r.stdout, /^-# Mine$/m);
  assert.match(r.stdout, /^\+@AGENTS\.md$/m);
  assert.equal(rd(root, 'CLAUDE.md'), '# Mine\nline two\n');
  assert.ok(!existsSync(join(root, 'AGENTS.md')));
  assert.equal(sync(root, ['--yes']).status, 0);
  assert.equal(rd(root, 'AGENTS.md'), '# Mine\nline two\n');
  assert.equal(rd(root, 'CLAUDE.md'), '@AGENTS.md\n');
});

test('both files exist: left alone', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'CLAUDE.md': 'c', 'AGENTS.md': 'a' });
  sync(root, ['--yes']);
  assert.equal(rd(root, 'CLAUDE.md'), 'c');
  assert.equal(rd(root, 'AGENTS.md'), 'a');
});

test('--yes twice is idempotent and --dry-run then exits 0', () => {
  const root = makeRepo({ 'sdlc/config.json': GATED });
  sync(root, ['--yes']);
  const paths = ['AGENTS.md', 'CLAUDE.md', RULES, '.claude/agents/verifier.md', '.codex/agents/verifier.toml', '.agents/agents/verifier.md'];
  const snap = paths.map((p) => rd(root, p));
  assert.equal(sync(root, ['--yes']).status, 0);
  assert.deepEqual(paths.map((p) => rd(root, p)), snap);
  assert.equal(sync(root, ['--dry-run']).status, 0);
});

test('interactive: y writes, anything else writes nothing', () => {
  const no = makeRepo({ 'sdlc/config.json': '{}' });
  const rn = sync(no, [], 'n\n');
  assert.equal(rn.status, 0);
  assert.match(rn.stdout, /Ghi các file trên\? \(y\/N\)/);
  assert.ok(!existsSync(join(no, 'AGENTS.md')));
  const yes = makeRepo({ 'sdlc/config.json': '{}' });
  assert.equal(sync(yes, [], 'y\n').status, 0);
  assert.ok(existsSync(join(yes, 'AGENTS.md')));
});

test('stale rules are shown as a diff and rewritten', () => {
  const root = makeRepo({ 'sdlc/config.json': GATED, [RULES]: 'old\n' });
  const r = sync(root, ['--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^-old$/m);
  sync(root, ['--yes']);
  assert.match(rd(root, RULES), /prefix_rule/);
});

test('no sdlc/config.json: refuses with exit 1', () => {
  const r = sync(makeRepo({}), ['--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sdlc\/config\.json/);
});

test('interactive: reads one line, does not wait for stdin EOF', async () => {
  const root = makeRepo({ 'sdlc/config.json': '{}' });
  const child = spawn(process.execPath, [SCRIPT], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.stdin.write('y\n'); // stdin deliberately left open
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await exited;
  clearTimeout(timer);
  assert.equal(code, 0);
  assert.ok(existsSync(join(root, 'AGENTS.md')));
});

test('empty CLAUDE.md is rewritten to the import line', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'CLAUDE.md': '  \n' });
  assert.equal(sync(root, ['--dry-run']).status, 1);
  assert.equal(sync(root, ['--yes']).status, 0);
  assert.equal(rd(root, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.ok(rd(root, 'AGENTS.md').includes('## Things agents get wrong'));
});

test('dangling CLAUDE.md symlink to AGENTS.md is skipped and reported, never written through', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}' });
  symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
  const r = sync(root, ['--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink());
  assert.ok(rd(root, 'AGENTS.md').includes('## Things agents get wrong'));
  assert.match(r.stdout, /symlink/);
});
