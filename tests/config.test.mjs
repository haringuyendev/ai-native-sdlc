import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config.mjs';
import { makeRepo } from './helpers.mjs';

test('no config file -> null config, no warning', () => {
  assert.deepEqual(loadConfig(makeRepo()), { config: null, warning: null });
});

test('missing keys fall back to defaults', () => {
  const root = makeRepo({ 'sdlc/config.json': '{"protected_paths":["src/gen/**"]}' });
  const { config } = loadConfig(root);
  assert.deepEqual(config.protected_paths, ['src/gen/**']);
  assert.deepEqual(config.test_globs, DEFAULT_CONFIG.test_globs);
  assert.equal(config.handoff_log, true);
});

test('invalid JSON -> null config with a warning', () => {
  const root = makeRepo({ 'sdlc/config.json': '{nope' });
  const { config, warning } = loadConfig(root);
  assert.equal(config, null);
  assert.match(warning, /sdlc\/config\.json/);
});

test('non-object JSON -> null config with a warning', () => {
  const root = makeRepo({ 'sdlc/config.json': '[]' });
  const { config, warning } = loadConfig(root);
  assert.equal(config, null);
  assert.match(warning, /sdlc\/config\.json/);
});

test('non-array list key -> null config with a warning naming the key', () => {
  const root = makeRepo({ 'sdlc/config.json': '{"protected_paths":"src/**"}' });
  const { config, warning } = loadConfig(root);
  assert.equal(config, null);
  assert.match(warning, /protected_paths/);
});

test('gate prefixes: wrong type -> null config + warning', () => {
  const root = makeRepo({ 'sdlc/config.json': '{"gates":[{"pattern":"x","reason":"r","prefixes":"git push"}]}' });
  const { config, warning } = loadConfig(root);
  assert.equal(config, null);
  assert.match(warning, /gates\[0\]\.prefixes phải là mảng các mảng chuỗi/);
});

test('gate prefixes: valid array of arrays', () => {
  const root = makeRepo({ 'sdlc/config.json': '{"gates":[{"pattern":"x","reason":"r","prefixes":[["git","push","-f"]]}]}' });
  assert.deepEqual(loadConfig(root).config.gates[0].prefixes, [['git', 'push', '-f']]);
});
