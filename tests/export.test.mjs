import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN_ROOT, makeRepo, gitInit } from './helpers.mjs';
import { exportPublic } from '../lib/export.mjs';

const listFiles = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = join(dir, e.name);
    if (e.isDirectory()) return e.name === '.git' ? [] : listFiles(abs, base);
    return [relative(base, abs).split('\\').join('/')];
  }).sort();

const AGENTS = '# x\n\n## Commands\n- npm test\n\n## SDLC harness\nRepo tự dùng chính harness này.\n\n## Notes\n- giữ\n';

function sourceRepo() {
  const root = makeRepo({
    'README.md': 'hi\n',
    'AGENTS.md': AGENTS,
    'lib/a.mjs': 'export const a = 1;\n',
    'sdlc/config.json': '{}',
    'sdlc/evals/trigger-a.json': '{"name":"trigger-a"}',
    'sdlc/changes/2026-01-01-x/progress.md': 'log riêng\n',
    'sdlc/lessons/2026-01-01-y.md': 'lesson riêng\n',
  });
  gitInit(root);
  return root;
}

const outDir = () => mkdtempSync(join(tmpdir(), 'sdlc-export-'));

test('exports tracked files but drops sdlc/changes and sdlc/lessons', () => {
  const out = outDir();
  exportPublic(sourceRepo(), out);
  assert.deepEqual(listFiles(out), ['AGENTS.md', 'README.md', 'lib/a.mjs', 'sdlc/config.json', 'sdlc/evals/trigger-a.json']);
});

test('exports the committed HEAD, not uncommitted or untracked edits', () => {
  const src = sourceRepo();
  writeFileSync(join(src, 'README.md'), 'sửa chưa commit\n');
  writeFileSync(join(src, 'untracked.txt'), 'x\n');
  const out = outDir();
  exportPublic(src, out);
  assert.equal(readFileSync(join(out, 'README.md'), 'utf8'), 'hi\n');
  assert.equal(existsSync(join(out, 'untracked.txt')), false);
});

test('removes only the "## SDLC harness" section from AGENTS.md', () => {
  const out = outDir();
  exportPublic(sourceRepo(), out);
  assert.equal(readFileSync(join(out, 'AGENTS.md'), 'utf8'), '# x\n\n## Commands\n- npm test\n\n## Notes\n- giữ\n');
});

test('replaces old content of the target but keeps its .git', () => {
  const out = outDir();
  mkdirSync(join(out, '.git'));
  writeFileSync(join(out, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(join(out, 'old'));
  writeFileSync(join(out, 'old', 'gone.md'), 'x\n');
  exportPublic(sourceRepo(), out);
  assert.equal(existsSync(join(out, 'old')), false);
  assert.equal(readFileSync(join(out, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/main\n');
});

test('export-public script exports into the given directory and reports the count', () => {
  const src = sourceRepo();
  const out = outDir();
  const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'export-public.mjs'), out], { cwd: src, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /5 file/);
  assert.ok(existsSync(join(out, 'sdlc', 'evals', 'trigger-a.json')));
});

test('export-public script without a target exits 2 with usage', () => {
  const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'export-public.mjs')], { cwd: sourceRepo(), encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Dùng:/);
});
