import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApplyPatch } from '../lib/patch.mjs';

test('add file', () => {
  assert.deepEqual(parseApplyPatch('*** Begin Patch\n*** Add File: b.txt\n+x\n*** End Patch'), [{ path: 'b.txt', op: 'add', added: 'x' }]);
});

test('update + add + delete keep order', () => {
  const t = '*** Begin Patch\n*** Update File: a.txt\n@@\n-hello\n+HELLO\n*** Add File: d.txt\n+one\n+two\n*** Delete File: e.txt\n*** End Patch';
  assert.deepEqual(parseApplyPatch(t), [
    { path: 'a.txt', op: 'update', added: 'HELLO' },
    { path: 'd.txt', op: 'add', added: 'one\ntwo' },
    { path: 'e.txt', op: 'delete', added: '' },
  ]);
});

test('move to', () => {
  const t = '*** Begin Patch\n*** Update File: a.txt\n*** Move to: c.txt\n@@\n-a\n+b\n*** End Patch';
  assert.deepEqual(parseApplyPatch(t), [{ path: 'a.txt', op: 'update', moveTo: 'c.txt', added: 'b' }]);
});

test('non-patch text -> []', () => {
  assert.deepEqual(parseApplyPatch('echo hi'), []);
  assert.deepEqual(parseApplyPatch(undefined), []);
});
