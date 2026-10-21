import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from './helpers.mjs';

const readJson = (p) => JSON.parse(readFileSync(join(PLUGIN_ROOT, p), 'utf8'));

test('plugin.json names the plugin and has a version', () => {
  const m = readJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'ai-native-sdlc');
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
});

test('marketplace.json lists the plugin from the repo root', () => {
  const m = readJson('.claude-plugin/marketplace.json');
  assert.equal(m.plugins[0].name, 'ai-native-sdlc');
  assert.equal(m.plugins[0].source, './');
});

test('package.json has no dependencies', () => {
  const p = readJson('package.json');
  assert.equal(p.dependencies, undefined);
  assert.equal(p.type, 'module');
});

test('plugin, marketplace and package versions agree', () => {
  const v = readJson('package.json').version;
  assert.equal(readJson('.claude-plugin/plugin.json').version, v);
  assert.equal(readJson('.claude-plugin/marketplace.json').plugins[0].version, v);
  assert.equal(v, '1.2.0');
});

test('codex manifest matches package name/version and points at codex hooks', () => {
  const m = readJson('.codex-plugin/plugin.json');
  assert.equal(m.name, 'ai-native-sdlc');
  assert.equal(m.version, readJson('package.json').version);
  assert.equal(m.hooks, './hooks/codex-hooks.json');
});

test('codex-hooks.json commands all use --agent codex', () => {
  const h = readJson('hooks/codex-hooks.json').hooks;
  const cmds = Object.values(h).flat().flatMap((g) => g.hooks.map((x) => x.command));
  assert.ok(cmds.length >= 4);
  for (const c of cmds) assert.match(c, /--agent codex/);
});

test('codex marketplace points at repo root', () => {
  const m = readJson('.agents/plugins/marketplace.json');
  assert.equal(m.plugins[0].name, 'ai-native-sdlc');
  assert.deepEqual(m.plugins[0].source, { source: 'local', path: './' });
});

test('agy root plugin.json is minimal: only name/version/description, no extensions or hooks', () => {
  const m = readJson('plugin.json');
  assert.deepEqual(Object.keys(m).sort(), ['description', 'name', 'version']);
  assert.equal(m.name, 'ai-native-sdlc');
  assert.equal(m.version, readJson('package.json').version);
  assert.equal('extensions' in m, false);
  assert.equal('hooks' in m, false);
});

test('agy hooks.json: every command uses --agent agy, matchers use real tool names', () => {
  const h = readJson('hooks.json')['ai-native-sdlc'];
  const groups = Object.values(h).flat();
  const cmds = groups.flatMap((g) => (g.hooks ? g.hooks.map((x) => x.command) : [g.command]));
  assert.equal(cmds.length, 4);
  // agy 1.4.3 does not expand ${PLUGIN_ROOT}/${CLAUDE_PLUGIN_ROOT} in commands (verified with a real install);
  // hooks run with cwd = the installed plugin root, so the path is relative.
  for (const c of cmds) assert.match(c, /^node hooks\/run\.mjs --agent agy --event /);
  assert.deepEqual(h.PreToolUse.map((g) => g.matcher), ['run_command', 'write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content']);
  assert.match(h.PreToolUse[0].hooks[0].command, /--event pre-bash/);
  assert.match(h.PreToolUse[1].hooks[0].command, /--event pre-edit/);
});

test('codex and claude manifests are untouched by the agy root manifest', () => {
  assert.equal(readJson('.codex-plugin/plugin.json').hooks, './hooks/codex-hooks.json');
  assert.equal(readJson('.claude-plugin/plugin.json').name, 'ai-native-sdlc');
});
