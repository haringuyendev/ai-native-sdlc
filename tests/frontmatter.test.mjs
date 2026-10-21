import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../lib/frontmatter.mjs';

const doc = `---
change: 2026-10-20-claims
title: "Tra cứu: trạng thái"
stage: build
next: Task 3/5, gắn panel
blocked_by:
test_lock: true
approvals:
  intent: { by: Hải, at: 2026-10-20 }
  spec: { by: Lan, at: 2026-10-21 }
links: {}
---
## Log
body here
`;

test('parses scalars, booleans, quotes and empty values', () => {
  const { data } = parseFrontmatter(doc);
  assert.equal(data.change, '2026-10-20-claims');
  assert.equal(data.title, 'Tra cứu: trạng thái');
  assert.equal(data.next, 'Task 3/5, gắn panel');
  assert.equal(data.blocked_by, '');
  assert.equal(data.test_lock, true);
});

test('parses indented maps of flow maps', () => {
  const { data } = parseFrontmatter(doc);
  assert.deepEqual(data.approvals, {
    intent: { by: 'Hải', at: '2026-10-20' },
    spec: { by: 'Lan', at: '2026-10-21' },
  });
  assert.deepEqual(data.links, {});
});

test('returns the body after the closing fence', () => {
  assert.equal(parseFrontmatter(doc).body, '## Log\nbody here\n');
});

test('text without frontmatter yields empty data', () => {
  assert.deepEqual(parseFrontmatter('# hi\n'), { data: {}, body: '# hi\n' });
});
