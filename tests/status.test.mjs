import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { renderStatus, statusFor } from '../scripts/sdlc-status.mjs';
import { makeRepo, progress, PLUGIN_ROOT } from './helpers.mjs';

test('renders one row per open change', () => {
  const out = renderStatus([
    { slug: 'c1', data: { stage: 'build', owner: 'Hải', next: 'Task 3 | nav', blocked_by: '' }, tasks: { done: 2, total: 5 }, updated: '2026-10-21' },
  ]);
  assert.match(out, /## SDLC: 1 change đang mở/);
  assert.match(out, /\| c1 \| build \| Hải \| 2\/5 \| Task 3 \\\| nav \| — \| 2026-10-21 \|/);
});

test('says so when nothing is open', () => {
  assert.match(renderStatus([]), /không có change nào đang mở/);
});

test('statusFor returns null outside a harness and a table inside one', () => {
  assert.equal(statusFor(makeRepo()), null);
  const root = makeRepo({ 'sdlc/config.json': '{}', 'sdlc/changes/x/progress.md': progress('stage: spec\nowner: Lan') });
  assert.match(statusFor(root), /\| x \| spec \| Lan \|/);
});

test('CLI prints the board for the given dir', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}' });
  const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'sdlc-status.mjs'), root], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /không có change nào đang mở/);
});

test('CLI outside a harness points at /ai-native-sdlc:init', () => {
  const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, 'scripts', 'sdlc-status.mjs'), makeRepo()], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\/ai-native-sdlc:init/);
});
