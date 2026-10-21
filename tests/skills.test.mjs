import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { PLUGIN_ROOT } from './helpers.mjs';

const SKILLS = join(PLUGIN_ROOT, 'skills');
// core workflow skills: short name → the long name it used to have (old names must not be referenced)
const CORE = {
  spec: 'brainstorming', plan: 'writing-plans', build: 'subagent-driven-development', run: 'executing-plans',
  tdd: 'test-driven-development', debug: 'systematic-debugging', verify: 'verification-before-completion',
  review: 'requesting-code-review', 'fix-review': 'receiving-code-review', worktree: 'using-git-worktrees',
  finish: 'finishing-a-development-branch', parallel: 'dispatching-parallel-agents',
};
const NEW = ['start', 'init', 'intent', 'resume', 'status', 'policy', 'agents-md', 'claude-md', 'eval', 'lesson'];
// Built by M3/M4. References to them are allowed until they exist; move a name out when its skill lands.
const PLANNED = [];
// Slash commands are addressed as /ai-native-sdlc:<name> too.
const COMMANDS = ['status'];
// "brainstorming" is excluded: it is also an ordinary word in the companion's text.
const OLD_NAMES = [
  ...Object.values(CORE).filter((n) => n !== 'brainstorming'), 'using-ai-native-sdlc', 'sdlc-init', 'capturing-intent',
  'writing-policy-skills', 'maintaining-claude-md', 'writing-evals', 'capturing-lessons',
];
const NEUTRAL_FORBIDDEN = ['Skill tool', '${CLAUDE_PLUGIN_ROOT}', 'Task tool', 'general-purpose', '.claude/skills', '+ Claude`', 'claude -p'];
const FORBIDDEN = ['superpowers:', 'docs/superpowers', '.superpowers/'];

const existing = readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const ALL = [...new Set([...Object.keys(CORE), ...NEW, ...existing])].sort();
// Every name in ALL has its own "exists" assertion below, so a reference to it resolves by the end of M2.
const KNOWN = new Set([...ALL, ...PLANNED, ...COMMANDS]);

const read = (f) => readFileSync(f, 'utf8');
const isText = (f) => /\.(md|sh|cjs|js|mjs|ts|html)$/.test(f) || !basename(f).includes('.');
function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]);
}

// Relative skill paths (`../<skill>/<file>`, resolved from the skill's folder) and
// `<plugin root>/templates/<file>` paths in a markdown text that point at nothing.
function brokenPaths(text, skillDir) {
  const broken = [];
  const clean = (p) => p.replace(/[.,:;)'"`]+$/, '');
  for (const [, p] of text.matchAll(/(\.\.\/[a-z0-9-]+\/[A-Za-z0-9_./-]+)/g)) {
    if (!existsSync(join(skillDir, clean(p)))) broken.push(clean(p));
  }
  for (const [, p] of text.matchAll(/<plugin root>\/(templates\/[A-Za-z0-9_./-]+)/g)) {
    if (!existsSync(join(PLUGIN_ROOT, clean(p)))) broken.push(clean(p));
  }
  return broken;
}

test('brokenPaths flags unresolvable relative skill and template paths', () => {
  const dir = join(SKILLS, 'plan');
  const fake = 'run `../build/scripts/no-such-script` and <plugin root>/templates/no-such.md.';
  assert.deepEqual(brokenPaths(fake, dir), ['../build/scripts/no-such-script', 'templates/no-such.md']);
  assert.deepEqual(brokenPaths('`../build/scripts/task-brief` and <plugin root>/templates/config.json', dir), []);
});

for (const name of ALL) {
  const dir = join(SKILLS, name);
  const skillFile = join(dir, 'SKILL.md');

  test(`${name}: SKILL.md exists, name matches the folder, description starts with "Use when"`, () => {
    assert.ok(existsSync(skillFile), `missing skills/${name}/SKILL.md`);
    const { data } = parseFrontmatter(read(skillFile));
    assert.equal(data.name, name);
    assert.match(String(data.description), name === 'claude-md' ? /^Alias of agents-md/ : /^Use when /);
  });

  test(`${name}: no references to the upstream plugin`, () => {
    for (const f of files(dir).filter(isText)) {
      const text = read(f);
      for (const s of FORBIDDEN) assert.ok(!text.includes(s), `${f} contains "${s}"`);
    }
  });

  test(`${name}: no long skill names left`, () => {
    for (const f of files(dir).filter(isText)) {
      const text = read(f);
      for (const old of OLD_NAMES) assert.ok(!text.includes(old), `${f} still says "${old}"`);
    }
  });

  test(`${name}: ai-native-sdlc cross-references resolve`, () => {
    for (const f of files(dir).filter((p) => p.endsWith('.md'))) {
      for (const [, ref] of read(f).matchAll(/ai-native-sdlc:([a-z0-9-]+)/g)) {
        assert.ok(KNOWN.has(ref), `${f} references unknown ai-native-sdlc:${ref}`);
      }
      assert.deepEqual(brokenPaths(read(f), dir), [], `${f} has unresolved relative paths`);
    }
  });

  test(`${name}: SKILL.md fits the 24000-byte limit agy loads`, () => {
    assert.ok(statSync(skillFile).size <= 24000, `${skillFile} is ${statSync(skillFile).size} bytes`);
  });

  if (name !== 'claude-md') {
    test(`${name}: agent-neutral wording`, () => {
      for (const f of files(dir).filter(isText)) {
        const text = read(f);
        for (const s of NEUTRAL_FORBIDDEN) assert.ok(!text.includes(s), `${f} contains "${s}"`);
        if (text.includes('.claude/agents/verifier.md')) {
          for (const other of ['.codex/agents/verifier.toml', '.agents/agents/verifier.md'])
            assert.ok(text.includes(other), `${f} names .claude/agents/verifier.md without ${other}`);
        }
        text.split('\n').forEach((line, i) => {
          if (line.includes('CLAUDE.md') && !line.includes('AGENTS.md')) assert.fail(`${f}:${i + 1} mentions CLAUDE.md without AGENTS.md`);
        });
      }
    });
  }

  test(`${name}: no per-file vendoring header`, () => {
    assert.ok(!/Vendored from/i.test(read(skillFile)));
  });
}

test('no third-party license file and no superpowers mention in skills', () => {
  assert.ok(!existsSync(join(PLUGIN_ROOT, 'LICENSE-THIRD-PARTY')), 'LICENSE-THIRD-PARTY still exists');
  assert.ok(!existsSync(join(PLUGIN_ROOT, 'NOTICE')));
  for (const f of files(SKILLS)) assert.ok(!/superpowers/i.test(read(f)), `${f} mentions superpowers`);
});

test('PLANNED lists only skills that do not exist yet', () => {
  for (const p of PLANNED) assert.ok(!existing.includes(p), `${p} exists: remove it from PLANNED`);
});

test('claude-md is a thin alias that routes to agents-md', () => {
  const { data, body } = parseFrontmatter(read(join(SKILLS, 'claude-md', 'SKILL.md')));
  assert.match(String(data.description), /^Alias of agents-md/);
  assert.ok(body.includes('agents-md'));
});

test('user commands ship as neutral skills, not Claude-only slash commands', () => {
  // Codex and agy load only skills/; a commands/*.md file is invisible or broken there.
  const commands = join(PLUGIN_ROOT, 'commands');
  const left = existsSync(commands) ? readdirSync(commands).filter((f) => f.endsWith('.md')) : [];
  assert.deepEqual(left, []);
  for (const name of COMMANDS) assert.ok(existsSync(join(SKILLS, name, 'SKILL.md')), `skills/${name}/SKILL.md`);
});
