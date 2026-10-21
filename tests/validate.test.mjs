import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeRepo } from './helpers.mjs';
import { validateChange, LOG_HEADING } from '../lib/validate.mjs';

const FM = (over = {}) => {
  const f = { change: 'c1', title: 'T', owner: 'Hải', stage: 'intent', next: 'x', blocked_by: '', test_lock: 'false', approvals: '', links: '{}', ...over };
  return `---\n${Object.entries(f).map(([k, v]) => `${k}:${v === '' ? '' : ' ' + v}`).join('\n')}\n---\n`;
};
const APPR = '\n  intent: { by: Hải, at: 2026-10-20 }\n  spec: { by: Hải, at: 2026-10-20 }';
const sec = (...hs) => hs.map((h) => `${h}\n\ntext\n`).join('\n');
const INTENT = sec('## Problem', '## Proposed outcome', '## Affected users and systems', '## Constraints', '## Open questions');
const SPEC = sec('## Requirements', '## Design', '## Policies applied', '## Flagged concerns', '## Answers to open questions', '## Out of scope');
const PLAN = sec('## Files that change', '## Order of work', '## Risks', '## Proof') + '- [ ] a\n- [X] b\n';
const REVIEW = sec('## Findings', '## Declined to judge', '## Verdict');
const LOG = '## Log\n### 2026-10-20 — Hải + Claude (M1 → M2)\n- ok\n';

function change(files) {
  const root = makeRepo(Object.fromEntries(Object.entries(files).map(([k, v]) => [`c1/${k}`, v])));
  return join(root, 'c1');
}
const full = (over = {}, extra = {}) =>
  change({ 'progress.md': FM({ stage: 'done', approvals: APPR, ...over }) + LOG, 'intent.md': INTENT, 'spec.md': SPEC, 'plan.md': PLAN, 'review.md': REVIEW, ...extra });
const msgs = (dir) => validateChange(dir).map((e) => e.message).join('\n');

test('a complete valid change has no errors', () => {
  assert.deepEqual(validateChange(full()), []);
});

test('stage intent with empty approvals is valid', () => {
  assert.deepEqual(validateChange(change({ 'progress.md': FM() + '## Log\n' })), []);
});

test('quoted blocked_by string is valid', () => {
  assert.deepEqual(validateChange(change({ 'progress.md': FM({ blocked_by: '"agy — chờ"' }) + LOG })), []);
});

test('invalid stage names the stage field', () => {
  assert.match(msgs(full({ stage: 'building' })), /stage/);
});

test('change differing from the directory name names the change field', () => {
  assert.match(msgs(full({ change: 'other' })), /change/);
});

test('approval missing at names approvals.spec', () => {
  assert.match(msgs(full({ approvals: '\n  spec: { by: Hải }' })), /approvals\.spec/);
});

test('log heading without the dash/agent is an error with a line', () => {
  const dir = change({ 'progress.md': FM() + '## Log\n### 2026-10-20 Hải\n' });
  const e = validateChange(dir).find((x) => /Log/.test(x.message));
  assert.ok(e);
  assert.equal(e.line, 13);
});

test('log heading with a trailing parenthetical is valid', () => {
  assert.ok(LOG_HEADING.test('### 2026-10-20 — Hải + Claude (M1)'));
  assert.deepEqual(validateChange(change({ 'progress.md': FM() + '## Log\n### 2026-10-20 — Hải + Claude (M1)\n' })), []);
});

test('stage plan without spec.md and ## Design is an error', () => {
  const dir = change({ 'progress.md': FM({ stage: 'plan', approvals: APPR }) + LOG, 'intent.md': INTENT });
  assert.match(msgs(dir), /spec/i);
});

test('bounded change with ## Design and approvals.spec is valid', () => {
  const dir = change({ 'progress.md': FM({ stage: 'plan', approvals: APPR }) + '## Design\nx\n' + LOG, 'intent.md': INTENT });
  assert.deepEqual(validateChange(dir), []);
});

test('stage plan without approvals.spec is an error', () => {
  const dir = change({ 'progress.md': FM({ stage: 'plan' }) + LOG, 'intent.md': INTENT, 'spec.md': SPEC });
  assert.match(msgs(dir), /approvals\.spec/);
});

test('spec.md missing ## Out of scope is an error', () => {
  assert.match(msgs(full({}, { 'spec.md': SPEC.replace('## Out of scope', '## Other') })), /## Out of scope/);
});

test('checkboxes: [X] valid, -[ ] invalid, fenced ignored', () => {
  assert.deepEqual(validateChange(full()), []);
  assert.match(msgs(full({}, { 'plan.md': PLAN + '-[ ] bad\n' })), /Checkbox/);
  assert.deepEqual(validateChange(full({}, { 'plan.md': PLAN + '```\n-[ ] fenced\n```\n' })), []);
});

test('bounded ## Plan checkboxes are checked too', () => {
  const dir = change({ 'progress.md': FM({ stage: 'build', approvals: APPR }) + '## Design\nx\n## Plan\n-[ ] bad\n' + LOG, 'intent.md': INTENT });
  assert.match(msgs(dir), /Checkbox/);
});

test('done change still validates', () => {
  assert.deepEqual(validateChange(full({ stage: 'done' })), []);
  assert.match(msgs(full({ stage: 'done', change: 'zzz' })), /change/);
});
