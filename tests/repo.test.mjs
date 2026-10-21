import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { findRoot, toRepoPath, changedFiles, headSha, filesChangedSince, EMPTY_TREE } from '../lib/repo.mjs';
import { makeRepo, gitInit } from './helpers.mjs';

test('findRoot walks up to the dir holding sdlc/config.json', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'src/deep/a.ts': '' });
  assert.equal(findRoot(join(root, 'src', 'deep')), root);
});

test('findRoot returns null without a harness', () => {
  assert.equal(findRoot(makeRepo({ 'a.txt': '' })), null);
});

test('toRepoPath makes posix paths relative to root', () => {
  const root = makeRepo();
  assert.equal(toRepoPath(root, join(root, 'src', 'a.ts')), 'src/a.ts');
  assert.equal(toRepoPath(root, 'src/b.ts'), 'src/b.ts');
  assert.match(toRepoPath(root, '/elsewhere/x.ts'), /^\.\./);
});

test('changedFiles lists modified and untracked files', () => {
  const root = makeRepo({ 'a.txt': 'one' });
  gitInit(root);
  writeFileSync(join(root, 'a.txt'), 'two');
  mkdirSync(join(root, 'sdlc'));
  writeFileSync(join(root, 'sdlc', 'n.md'), 'x');
  assert.deepEqual(changedFiles(root).sort(), ['a.txt', 'sdlc/n.md']);
});

test('changedFiles returns non-ASCII and spaced names verbatim', () => {
  const root = makeRepo({ 'a.txt': 'one' });
  gitInit(root);
  mkdirSync(join(root, 'sdlc'));
  writeFileSync(join(root, 'sdlc', 'ghi chú.md'), 'x');
  assert.deepEqual(changedFiles(root), ['sdlc/ghi chú.md']);
});

test('headSha and filesChangedSince', () => {
  const root = makeRepo({ 'a.txt': '1' });
  gitInit(root);
  const base = headSha(root);
  assert.match(base, /^[0-9a-f]{40}$/);
  writeFileSync(join(root, 'b.txt'), '2');
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'b'], { cwd: root });
  assert.deepEqual(filesChangedSince(root, base), ['b.txt']);
  assert.deepEqual(filesChangedSince(root, headSha(root)), []);
  assert.equal(headSha(makeRepo()), null);
});

test('filesChangedSince from the empty tree lists every committed file', () => {
  const root = makeRepo({ 'a.txt': '1', 'd/b.txt': '2' });
  gitInit(root);
  assert.deepEqual(filesChangedSince(root, EMPTY_TREE).sort(), ['a.txt', 'd/b.txt']);
});
