import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { countTasks, lastLogDate, listChanges, openChanges, stripFences } from '../lib/changes.mjs';
import { makeRepo, progress } from './helpers.mjs';

test('countTasks counts checked and unchecked boxes at line start', () => {
  const text = '- [x] a\n- [ ] b\n  - [X] c\n* [ ] d\ntext - [ ] inline';
  assert.deepEqual(countTasks(text), { done: 2, total: 4 });
});

test('lastLogDate picks the latest dated log heading', () => {
  assert.equal(lastLogDate('## Log\n### 2026-10-20 — A\n### 2026-10-22 — B\n### 2026-10-21 — C\n'), '2026-10-22');
  assert.equal(lastLogDate('## Log\n'), '');
});

function fixture() {
  return makeRepo({
    'sdlc/config.json': '{}',
    'sdlc/changes/2026-10-01-a/progress.md': progress('stage: build\nowner: Hải', '## Log\n### 2026-10-02 — Hải\n'),
    'sdlc/changes/2026-10-01-a/plan.md': '- [x] one\n- [ ] two\n',
    'sdlc/changes/2026-10-02-b/progress.md': progress('stage: done'),
    'sdlc/changes/2026-10-03-c/progress.md': progress('stage: intent', '## Log\n- [ ] inline task\n'),
    'sdlc/changes/not-a-change/readme.md': 'x',
  });
}

test('listChanges reads every change folder with a progress.md', () => {
  const changes = listChanges(fixture());
  assert.deepEqual(changes.map((c) => c.slug), ['2026-10-01-a', '2026-10-02-b', '2026-10-03-c']);
  assert.deepEqual(changes[0].tasks, { done: 1, total: 2 });
  assert.equal(changes[0].updated, '2026-10-02');
  assert.deepEqual(changes[2].tasks, { done: 0, total: 0 });
});

test('openChanges drops done and dropped changes', () => {
  assert.deepEqual(openChanges(fixture()).map((c) => c.slug), ['2026-10-01-a', '2026-10-03-c']);
});

test('no sdlc/changes dir -> empty list', () => {
  assert.deepEqual(listChanges(makeRepo({ 'sdlc/config.json': '{}' })), []);
});

test('countTasks and lastLogDate ignore fenced code', () => {
  const fence = '```';
  const text = `- [x] a\n${fence}md\n- [ ] sample\n### 2099-01-01 — x\n${fence}\n- [ ] b\n`;
  assert.deepEqual(countTasks(text), { done: 1, total: 2 });
  assert.equal(lastLogDate(`## Log\n### 2026-10-20 — A\n~~~\n### 2099-01-01 — x\n~~~\n`), '2026-10-20');
  assert.equal(stripFences(`a\n${fence}\nb\n${fence}\nc`), 'a\nc');
});

test('listChanges skips an unreadable change and keeps the rest', () => {
  const root = makeRepo({ 'sdlc/changes/good/progress.md': progress('stage: build') });
  mkdirSync(join(root, 'sdlc', 'changes', 'bad', 'progress.md'), { recursive: true });
  const orig = process.stderr.write;
  let err = '';
  process.stderr.write = (s) => { err += s; return true; };
  let list;
  try {
    list = listChanges(root);
  } finally {
    process.stderr.write = orig;
  }
  assert.deepEqual(list.map((c) => c.slug), ['good']);
  assert.match(err, /\[ai-native-sdlc\] bỏ qua bad: /);
});

test('bounded change counts only checkboxes inside its ## Plan section', () => {
  const body = '## Design\n- [ ] design note\n\n## Plan\n### Task 1: a\n- [x] **Step 1: x**\n- [ ] **Step 2: y**\n\n## Log\n- [ ] log item\n';
  const root = makeRepo({ 'sdlc/changes/2026-10-05-d/progress.md': progress('stage: build', body) });
  assert.deepEqual(listChanges(root)[0].tasks, { done: 1, total: 2 });
});
