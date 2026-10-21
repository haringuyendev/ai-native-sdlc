import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers.mjs';
import { codexProjectTrusted } from '../lib/codex-trust.mjs';

function codexHome(projects) {
  const home = makeRepo();
  const toml = Object.entries(projects)
    .map(([p, level]) => `[projects."${p}"]\ntrust_level = "${level}"\n`)
    .join('\n');
  writeFileSync(join(home, 'config.toml'), `model = "x"\n\n${toml}`);
  return home;
}

test('trusted when the repo root or a parent is trusted', () => {
  const root = realpathSync(makeRepo());
  assert.equal(codexProjectTrusted(root, codexHome({ [root]: 'trusted' })), true);
  const sub = join(root, 'pkg');
  mkdirSync(sub);
  assert.equal(codexProjectTrusted(sub, codexHome({ [root]: 'trusted' })), true);
});

test('untrusted when marked untrusted, missing, or the closest entry is untrusted', () => {
  const root = realpathSync(makeRepo());
  const sub = join(root, 'pkg');
  mkdirSync(sub);
  assert.equal(codexProjectTrusted(root, codexHome({ [root]: 'untrusted' })), false);
  assert.equal(codexProjectTrusted(root, codexHome({ '/somewhere/else': 'trusted' })), false);
  assert.equal(codexProjectTrusted(sub, codexHome({ [root]: 'trusted', [sub]: 'untrusted' })), false);
  assert.equal(codexProjectTrusted(`${root}-other`, codexHome({ [root]: 'trusted' })), false);
});

test('untrusted when the Codex config is missing or unreadable', () => {
  const root = realpathSync(makeRepo());
  assert.equal(codexProjectTrusted(root, makeRepo()), false);
  assert.equal(codexProjectTrusted(root, join(root, 'no-such-home')), false);
});

test('a path reached through a symlink matches its real path', () => {
  // os.tmpdir() is a symlink on macOS (/var → /private/var); Codex records real paths.
  const root = makeRepo();
  assert.equal(codexProjectTrusted(root, codexHome({ [realpathSync(root)]: 'trusted' })), true);
});
