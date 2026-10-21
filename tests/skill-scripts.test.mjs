import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeRepo, gitInit, PLUGIN_ROOT } from './helpers.mjs';

const SDD = join(PLUGIN_ROOT, 'skills', 'build', 'scripts');
const EXEC = join(PLUGIN_ROOT, 'skills', 'run', 'scripts');
const BRAIN = join(PLUGIN_ROOT, 'skills', 'spec', 'scripts');
const ALPHA = 'sdlc/changes/2026-01-02-alpha/plan.md';
const BOUNDED = 'sdlc/changes/2026-01-03-b/progress.md';
const BETA = 'sdlc/changes/2026-01-03-beta/plan.md';
const PLAN = [
  '# Plan: x', '', '## Order of work', '',
  '### Task 1: First', '- [ ] **Step 1: one**', '',
  '### Task 2: Second', '- [ ] **Step 1: two**', '```md', '## Fenced heading stays in the brief', '```', '',
  '## Risks', '- none', '',
].join('\n');

const bash = (cwd, script, ...args) => {
  const r = spawnSync('bash', [script, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
};
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
function repo() {
  const root = makeRepo({ [ALPHA]: PLAN, [BETA]: PLAN, [BOUNDED]: '---\nstage: build\n---\n## Design\nd\n\n## Plan\n### Task 1: Only\n- [ ] **Step 1: a**\n\n### Task 2: Other\n- [ ] **Step 1: b**\n\n## Log\n### Task 1 note\n', 'docs/other-plan.md': PLAN });
  gitInit(root);
  return realpathSync(root);
}
const workspace = (root, plan) => bash(root, join(SDD, 'sdd-workspace'), plan).out;

test('sdd-workspace keys plan.md by its change folder', () => {
  const root = repo();
  assert.equal(workspace(root, ALPHA), join(root, '.ai-sdlc', 'sdd', '2026-01-02-alpha'));
  assert.equal(workspace(root, BETA), join(root, '.ai-sdlc', 'sdd', '2026-01-03-beta'));
  assert.equal(workspace(root, ALPHA), join(root, '.ai-sdlc', 'sdd', '2026-01-02-alpha'));
});

test('sdd-workspace keys a bounded progress.md by its change folder', () => {
  const root = repo();
  assert.equal(workspace(root, BOUNDED), join(root, '.ai-sdlc', 'sdd', '2026-01-03-b'));
});

test('task-brief on a bounded progress.md stops at ## Log', () => {
  const root = repo();
  assert.equal(bash(root, join(SDD, 'task-brief'), BOUNDED, '2').code, 0);
  const brief = readFileSync(join(workspace(root, BOUNDED), 'task-2-brief.md'), 'utf8');
  assert.match(brief, /^### Task 2: Other/);
  assert.doesNotMatch(brief, /Task 1|## Log/);
});

test('sdd-workspace keeps the basename of other plan files', () => {
  const root = repo();
  assert.equal(workspace(root, 'docs/other-plan.md'), join(root, '.ai-sdlc', 'sdd', 'other-plan'));
});

test('sdd-workspace stays out of git status', () => {
  const root = repo();
  const r = bash(root, join(SDD, 'sdd-workspace'), ALPHA);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(root, '.ai-sdlc')));
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('task-brief extracts one task and stops at the next section', () => {
  const root = repo();
  const r = bash(root, join(SDD, 'task-brief'), ALPHA, '2');
  assert.equal(r.code, 0, r.err);
  const brief = readFileSync(join(workspace(root, ALPHA), 'task-2-brief.md'), 'utf8');
  assert.match(brief, /^### Task 2: Second/);
  assert.match(brief, /Fenced heading stays in the brief/);
  assert.doesNotMatch(brief, /Task 1|## Risks/);
});

test('task-done records a ledger line only when the tests pass', () => {
  const root = repo();
  const base = /^base: (\w+)$/m.exec(bash(root, join(EXEC, 'task-start'), ALPHA, '1').out)[1];
  const ledger = join(workspace(root, ALPHA), 'ledger.md');
  assert.notEqual(bash(root, join(EXEC, 'task-done'), ALPHA, '1', base, '--', 'false').code, 0);
  assert.ok(!existsSync(ledger) || !readFileSync(ledger, 'utf8').includes('Task 1: complete'));
  assert.equal(bash(root, join(EXEC, 'task-done'), ALPHA, '1', base, '--', 'true').code, 0);
  const text = readFileSync(ledger, 'utf8');
  assert.ok(text.startsWith(`# SDD ledger — plan: ${ALPHA}\n`));
  assert.match(text, /^Task 1: complete \(commits \w{7}\.\.\w{7}, tests: true /m);
});

test('review-package writes the range into the change workspace', () => {
  const root = repo();
  const base = git(root, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-qm', 'a');
  const r = bash(root, join(SDD, 'review-package'), ALPHA, base, 'HEAD');
  assert.equal(r.code, 0, r.err);
  const file = /^wrote (.+): 1 commit/.exec(r.out)[1];
  assert.equal(dirname(file), workspace(root, ALPHA));
  assert.match(readFileSync(file, 'utf8'), /^# Review package/);
});

test('brainstorm server keeps sessions under .ai-sdlc/brainstorm', () => {
  const root = repo();
  const r = bash(root, join(BRAIN, 'start-server.sh'), '--project-dir', root);
  assert.equal(r.code, 0, r.out + r.err);
  const info = JSON.parse(r.out);
  try {
    assert.ok(info.screen_dir.startsWith(join(root, '.ai-sdlc', 'brainstorm') + '/'), info.screen_dir);
    assert.equal(git(root, 'status', '--porcelain'), '');
  } finally {
    bash(root, join(BRAIN, 'stop-server.sh'), dirname(info.screen_dir));
  }
});

// Safety net for the core-skill rewrite: these pin the old scripts' observable behavior.
import { mkdtempSync as mkdtempSync2, mkdirSync as mkdirSync2 } from 'node:fs';
import { tmpdir as tmpdir2 } from 'node:os';

const DEBUG = join(PLUGIN_ROOT, 'skills', 'debug');

test('task-brief exits 3 when the task is missing', () => {
  const root = repo();
  const r = bash(root, join(SDD, 'task-brief'), ALPHA, '9');
  assert.equal(r.code, 3);
  assert.match(r.err, /task 9 not found in /);
});

test('review-package exits 3 when HEAD is not a descendant of BASE', () => {
  const root = repo();
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-qm', 'a');
  const r = bash(root, join(SDD, 'review-package'), ALPHA, 'HEAD', 'HEAD~1');
  assert.equal(r.code, 3);
  assert.match(r.err, /HEAD is not a descendant of BASE/);
});

test('task-start prints brief and base', () => {
  const root = repo();
  const r = bash(root, join(EXEC, 'task-start'), ALPHA, '1');
  assert.equal(r.code, 0, r.err);
  const brief = /^brief: (.+)$/m.exec(r.out)[1];
  assert.equal(brief, join(workspace(root, ALPHA), 'task-1-brief.md'));
  assert.match(readFileSync(brief, 'utf8'), /^### Task 1: First/);
  assert.equal(/^base: (\w+)$/m.exec(r.out)[1], git(root, 'rev-parse', 'HEAD').trim());
});

test('scripts work when the repo path contains a space', () => {
  const parent = join(realpathSync(mkdtempSync2(join(tmpdir2(), 'sdlc-space-'))), 'with space');
  mkdirSync2(join(parent, dirname(ALPHA)), { recursive: true });
  writeFileSync(join(parent, ALPHA), PLAN);
  gitInit(parent);
  const ws = bash(parent, join(SDD, 'sdd-workspace'), ALPHA);
  assert.equal(ws.code, 0, ws.err);
  assert.equal(ws.out, join(parent, '.ai-sdlc', 'sdd', '2026-01-02-alpha'));
  const brief = bash(parent, join(SDD, 'task-brief'), ALPHA, '1');
  assert.equal(brief.code, 0, brief.err);
  const base = git(parent, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(parent, 'a.txt'), 'a\n');
  git(parent, 'add', 'a.txt');
  git(parent, 'commit', '-qm', 'a');
  const pkg = bash(parent, join(SDD, 'review-package'), ALPHA, base, 'HEAD');
  assert.equal(pkg.code, 0, pkg.err);
  const done = bash(parent, join(EXEC, 'task-done'), ALPHA, '1', base, '--', 'true');
  assert.equal(done.code, 0, done.err);
  assert.match(readFileSync(join(ws.out, 'ledger.md'), 'utf8'), /^Task 1: complete \(commits /m);
});

test('find-polluter reports the test that creates the file', () => {
  const root = realpathSync(makeRepo({
    'package.json': JSON.stringify({ name: 'p', private: true, scripts: { test: 'node' } }),
    'a.test.js': '',
    'b.test.js': "require('fs').writeFileSync('.polluted', 'x');\n",
  }));
  const r = bash(root, join(DEBUG, 'find-polluter.sh'), '.polluted', '*.test.js');
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /FOUND POLLUTER!\n\s+Test: \.\/b\.test\.js/);
  assert.doesNotMatch(r.out, /Test: \.\/a\.test\.js/);
});
