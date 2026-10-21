import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';
import { validateEval } from '../lib/evals.mjs';
import { PLUGIN_ROOT } from './helpers.mjs';

const read = (p) => readFileSync(join(PLUGIN_ROOT, 'templates', p), 'utf8');

const HEADINGS = {
  'intent.md': ['## Problem', '## Proposed outcome', '## Affected users and systems', '## Constraints', '## Open questions'],
  'spec.md': ['## Requirements', '## Design', '## Policies applied', '## Flagged concerns', '## Answers to open questions', '## Out of scope'],
  'plan.md': ['## Files that change', '## Order of work', '## Risks', '## Proof'],
  'lesson.md': ['## What happened', '## Evidence', '## Root cause', '## Fix', '## Regression guard', '## AGENTS.md update'],
  'AGENTS.md': ['## Commands', '## Conventions', '## Architecture', '## Verifying your work', '## Things agents get wrong', '## SDLC harness'],
  'review-report.md': ['## Findings', '## Declined to judge', '## Verdict'],
  'policy-skill.md': ['## When this applies', '## Rules', '## Check', '## Exceptions'],
  'REVIEW.md': ['## Passes', '## What Important means here', '## Cap the nits', '## Do not report'],
};

for (const [file, headings] of Object.entries(HEADINGS)) {
  test(`${file} has the fixed headings`, () => {
    const text = read(file);
    for (const h of headings) assert.ok(text.includes(h), `${file} missing ${h}`);
  });
}

test('config.json template has every default key', () => {
  const cfg = JSON.parse(read('config.json'));
  for (const key of Object.keys(DEFAULT_CONFIG)) assert.ok(key in cfg, key);
});

test('progress.md template starts at stage intent with a Log section', () => {
  const { data, body } = parseFrontmatter(read('progress.md'));
  assert.equal(data.stage, 'intent');
  assert.equal(data.test_lock, false);
  assert.match(body, /^## Log/m);
});

test('verifier agent has name, description and tools', () => {
  const { data } = parseFrontmatter(read('agents/verifier.md'));
  assert.equal(data.name, 'verifier');
  assert.ok(data.description);
  assert.ok(data.tools);
});

test('CLAUDE.md template is the one-line import of AGENTS.md', () => {
  assert.equal(read('CLAUDE.md'), '@AGENTS.md\n');
});

test('codex and agy verifiers carry the same instructions as the claude one', () => {
  const body = parseFrontmatter(read('agents/verifier.md')).body.trim();
  const toml = read('agents/verifier.toml');
  assert.match(toml, /^name = "verifier"$/m);
  assert.match(toml, /^description = ".+"$/m);
  assert.ok(toml.includes(`developer_instructions = """\n${body}\n"""`));
  const agy = parseFrontmatter(read('agents/verifier.agy.md'));
  assert.equal(agy.data.name, 'verifier');
  assert.ok(agy.data.description);
  assert.equal(agy.body.trim(), body);
});

test('eval.json template is a valid eval', () => {
  assert.deepEqual(validateEval(JSON.parse(read('eval.json'))), []);
});

function caseCollisions(paths) {
  const groups = new Map();
  for (const p of paths) {
    const key = p.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function filesUnder(dir) {
  return readdirSync(join(PLUGIN_ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? filesUnder(rel) : [rel];
  });
}

test('caseCollisions groups paths that differ only by case', () => {
  assert.deepEqual(caseCollisions(['a/X.md', 'a/x.md', 'b.md']), [['a/X.md', 'a/x.md']]);
});

test('no two plugin files differ only by case', () => {
  assert.deepEqual(caseCollisions([...filesUnder('templates'), ...filesUnder('skills')]), []);
});
