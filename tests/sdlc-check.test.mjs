import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PLUGIN_ROOT, makeRepo, progress } from './helpers.mjs';

const run = (cwd, ...args) => spawnSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'sdlc-check.mjs'), ...args], { cwd, encoding: 'utf8' });

test('sdlc-check passes on this repo (open changes)', () => {
  const r = run(PLUGIN_ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), 'OK');
});

test('sdlc-check prints file:line message and exits 1 on errors; slug checks any stage', () => {
  const root = makeRepo({
    'sdlc/config.json': '{}',
    'sdlc/changes/c1/progress.md': progress('change: c1\ntitle: T\nowner: H\nstage: done\nnext: x\ntest_lock: false\napprovals:\nlinks: {}', '## Log\n### 2026-10-20 H\n'),
  });
  assert.equal(run(root).status, 0);
  const r = run(root, 'c1');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /c1\/progress\.md:\d+ .*Log/);
});
