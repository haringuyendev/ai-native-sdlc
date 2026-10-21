import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { outputChecks, timeoutChecks } from '../lib/evals.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { skillFromPath, skillsFromCommand } from '../adapters/eval-util.mjs';
import { PLUGIN_ROOT, makeRepo, gitInit } from './helpers.mjs';

const SCRIPT = join(PLUGIN_ROOT, 'scripts', 'run-evals.mjs');
const fixture = (agent, name) => readFileSync(join(PLUGIN_ROOT, 'tests', 'fixtures', agent, name), 'utf8');

test('claude-code parseEvalStream normalises skill names to short names', () => {
  const text = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'ai-native-sdlc:intent' } }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'xong', is_error: false }),
  ].join('\n');
  assert.deepEqual(getAdapter('claude-code').parseEvalStream(text), { result: 'xong', skills: ['intent'], isError: false, subtype: 'success' });
});

test('codex parseEvalStream detects a plugin skill read from a real stream', () => {
  const p = getAdapter('codex').parseEvalStream(fixture('codex', 'eval-stream-read.jsonl'));
  assert.equal(p.skills[0], 'intent');
  assert.equal(p.isError, false);
  assert.ok(p.result.length > 0);
});

test('codex parseEvalStream ignores global skills and silent $-invocations', () => {
  const natural = getAdapter('codex').parseEvalStream(fixture('codex', 'eval-stream-natural.jsonl'));
  assert.deepEqual(natural.skills, []);
  assert.equal(natural.isError, false);
  assert.deepEqual(getAdapter('codex').parseEvalStream(fixture('codex', 'eval-stream.jsonl')).skills, []);
});

test('skill path detection only counts ai-native-sdlc skills', () => {
  assert.deepEqual(skillFromPath('/home/u/.agents/skills/plan/SKILL.md'), []);
  assert.deepEqual(skillFromPath('/h/.codex/plugins/cache/ai-native-sdlc/ai-native-sdlc/1.0.1/skills/plan/SKILL.md'), ['plan']);
  assert.deepEqual(skillFromPath('/h/.gemini/config/plugins/ai-native-sdlc/skills/start/SKILL.md'), []);
  assert.deepEqual(skillFromPath('/h/other-plugin/skills/plan/SKILL.md'), []);
});

test('shell commands count only when a read-like program reads the skill', () => {
  const p = '/c/ai-native-sdlc/skills';
  assert.deepEqual(skillsFromCommand(`/bin/zsh -lc 'cat ${p}/plan/SKILL.md'`), ['plan']);
  assert.deepEqual(skillsFromCommand(`/bin/zsh -lc "pwd && sed -n 1,40p ${p}/spec/SKILL.md"`), ['spec']);
  assert.deepEqual(skillsFromCommand(`/bin/zsh -lc "cat ${p}/plan/SKILL.md ${p}/spec/SKILL.md"`), ['plan', 'spec']);
  assert.deepEqual(skillsFromCommand(`/bin/zsh -lc "rg intent ${p}/plan/SKILL.md"`), []);
  assert.deepEqual(skillsFromCommand(`/bin/zsh -lc "find ${p} -name SKILL.md"`), []);
});

test('agy ignores write_file steps on skill paths', () => {
  const step = (tool_name) => JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', tool_name, tool_info: { parameters: { Path: '/p/ai-native-sdlc/skills/plan/SKILL.md' } } } });
  assert.deepEqual(getAdapter('agy').parseEvalStream(step('view_file')).skills, ['plan']);
  assert.deepEqual(getAdapter('agy').parseEvalStream(step('write_to_file')).skills, []);
});

test('codex parseEvalStream flags a failed turn and empty output', () => {
  assert.equal(getAdapter('codex').parseEvalStream('').isError, true);
  assert.equal(getAdapter('codex').parseEvalStream('{"type":"turn.failed","error":{"message":"boom"}}\n').isError, true);
});

test('agy parseEvalStream detects the skill from a real stream', () => {
  const p = getAdapter('agy').parseEvalStream(fixture('agy', 'eval-stream.jsonl'));
  assert.equal(p.skills[0], 'intent');
  assert.equal(p.isError, false);
  assert.match(p.result, /harness/);
  assert.equal(p.subtype, 'success');
  assert.equal(getAdapter('agy').parseEvalStream('').isError, true);
});

test('skill checks ignore the ai-native-sdlc: prefix on both sides', () => {
  const e = { checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:intent' }, { type: 'skill_never', skill: 'ai-native-sdlc:plan' }] };
  assert.ok(outputChecks(e, { result: '', skills: ['intent'] }).every((c) => c.pass));
  assert.ok(outputChecks(e, { result: '', skills: ['ai-native-sdlc:intent'] }).every((c) => c.pass));
  assert.equal(outputChecks(e, { result: '', skills: ['plan', 'intent'] }).filter((c) => !c.pass).length, 2);
});

test('evalCommand builds each agent command', () => {
  const base = { prompt: 'P', maxTurns: 3, timeoutSec: 90, args: ['--x'], allowedTools: 'Read,Bash(ls)', pluginDir: '/p', cwd: '/w' };
  const c = getAdapter('claude-code').evalCommand(base);
  assert.deepEqual(c.argv.slice(0, 2), ['-p', 'P']);
  assert.ok(c.argv.includes('--plugin-dir') && c.argv.includes('--x'));
  const x = getAdapter('codex').evalCommand(base);
  assert.deepEqual(x.argv.slice(0, 8), ['exec', '--json', '-s', 'workspace-write', '-m', 'gpt-6-luna', '--dangerously-bypass-hook-trust', '--skip-git-repo-check']);
  assert.equal(x.argv.at(-1), 'P');
  assert.ok(!x.argv.includes('--x') && !x.argv.includes('--plugin-dir'));
  const a = getAdapter('agy').evalCommand(base);
  assert.deepEqual(a.argv, ['-p', 'P', '--output-format', 'stream-json', '--print-timeout', '90s', '--dangerously-skip-permissions']);
});

// --- run-evals --agent with fake binaries ---

function fakeAgent(kind) {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-fake-'));
  const file = join(dir, kind);
  const out = {
    codex: `console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'cat /x/ai-native-sdlc/skills/intent/SKILL.md' } }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'xong' } }));
console.log(JSON.stringify({ type: 'turn.completed' }));`,
    agy: `console.log(JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', state: 'DONE', tool_name: 'read_file', tool_info: { parameters: { Path: '/x/ai-native-sdlc/skills/intent/SKILL.md' } } } }));
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'xong' } }));`,
  }[kind];
  writeFileSync(file, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('argv.json', JSON.stringify(process.argv.slice(2)));\n${out}\n`);
  chmodSync(file, 0o755);
  return file;
}

const argvCheck = (joined) => ({ type: 'command', run: `node -e "const a=require('./argv.json');process.exit(a.join('|')==='${joined}'?0:1)"` });

function evalRepo(e) {
  const root = makeRepo({ 'sdlc/config.json': '{}', [`sdlc/evals/${e.name}.json`]: JSON.stringify(e) });
  gitInit(root);
  return root;
}

function run(root, flags, env = {}) {
  const e = { ...process.env, ...env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete e[k];
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...flags], { encoding: 'utf8', env: e });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const base = { description: 'd', source: 'task', prompt: 'ý tưởng mới' };

test('--agent codex passes the exact argv and detects the skill', () => {
  const root = evalRepo({
    ...base,
    name: 'c',
    allowed_tools: 'Read',
    args: ['--nope'],
    checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:intent' }, argvCheck('exec|--json|-s|workspace-write|-m|m-test|--dangerously-bypass-hook-trust|--skip-git-repo-check|ý tưởng mới')],
  });
  const r = run(root, ['--agent', 'codex'], { AI_SDLC_CODEX_BIN: fakeAgent('codex'), AI_SDLC_CODEX_MODEL: 'm-test' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS c/);
});

test('--agent agy passes the exact argv and detects the skill', () => {
  const root = evalRepo({
    ...base,
    name: 'a',
    timeout_sec: 77,
    checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:intent' }, argvCheck('-p|ý tưởng mới|--output-format|stream-json|--print-timeout|77s|--dangerously-skip-permissions')],
  });
  const r = run(root, ['--agent', 'agy'], { AI_SDLC_AGY_BIN: fakeAgent('agy'), AI_SDLC_AGY_MODEL: '' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS a/);
});

test('unknown --agent exits 2 with a message', () => {
  const root = evalRepo({ ...base, name: 'u', checks: [{ type: 'command', run: 'true' }] });
  const r = run(root, ['--agent', 'nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--agent/);
  assert.match(r.stderr, /nope/);
});

// --- timeout: grade the partial stream (codex/agy have no turn cap) ---

test('timeoutChecks grades skill checks on a partial stream; no skill means "quá thời gian"', () => {
  const e = (checks) => ({ checks });
  assert.deepEqual(timeoutChecks(e([{ type: 'skill_first', skill: 'ai-native-sdlc:plan' }]), { skills: ['plan'], result: '' }, 600), []);
  assert.deepEqual(timeoutChecks(e([{ type: 'skill_first', skill: 'ai-native-sdlc:plan' }]), { skills: [], result: '' }, 600), ['quá thời gian 600s']);
  assert.match(timeoutChecks(e([{ type: 'skill_first', skill: 'ai-native-sdlc:plan' }]), { skills: ['run'], result: '' }, 9)[0], /quá thời gian 9s.*skill đầu tiên là run/);
  assert.deepEqual(timeoutChecks(e([{ type: 'skill_never', skill: 'ai-native-sdlc:tdd' }]), { skills: ['debug'], result: '' }, 9), []);
  // checks that need a finished run cannot pass on a killed one
  assert.match(timeoutChecks(e([{ type: 'skill_first', skill: 'plan' }, { type: 'command', run: 'true' }]), { skills: ['plan'], result: '' }, 9)[0], /quá thời gian 9s.*command/);
  assert.match(timeoutChecks(e([{ type: 'output_includes', text: 'x' }]), { skills: ['plan'], result: 'x' }, 9)[0], /output_includes/);
});

test('only codex and agy grade partial streams on timeout', () => {
  assert.equal(getAdapter('codex').gradePartialOnTimeout, true);
  assert.equal(getAdapter('agy').gradePartialOnTimeout, true);
  assert.ok(!getAdapter('claude-code').gradePartialOnTimeout);
});

test('AI_SDLC_AGY_MODEL adds --model to the agy command', () => {
  const old = process.env.AI_SDLC_AGY_MODEL;
  try {
    process.env.AI_SDLC_AGY_MODEL = 'claude-sonnet-4-6';
    const a = getAdapter('agy').evalCommand({ prompt: 'P', timeoutSec: 90 });
    assert.deepEqual(a.argv.slice(-2), ['--model', 'claude-sonnet-4-6']);
    delete process.env.AI_SDLC_AGY_MODEL;
    assert.ok(!getAdapter('agy').evalCommand({ prompt: 'P', timeoutSec: 90 }).argv.includes('--model'));
  } finally {
    if (old === undefined) delete process.env.AI_SDLC_AGY_MODEL;
    else process.env.AI_SDLC_AGY_MODEL = old;
  }
});

// Fake agy that prints its stream (optionally invoking a skill) and then hangs past the eval timeout.
function hangingAgy(skill) {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-fake-'));
  const file = join(dir, 'agy');
  const line = skill
    ? JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', state: 'DONE', tool_name: 'read_file', tool_info: { parameters: { Path: `/x/ai-native-sdlc/skills/${skill}/SKILL.md` } } } })
    : JSON.stringify({ event: 'init', conversation_id: 'c' });
  writeFileSync(file, `#!/usr/bin/env node\nimport { writeSync } from 'node:fs';\nwriteSync(1, ${JSON.stringify(`${line}\n`)});\nsetTimeout(() => {}, 20000);\n`);
  chmodSync(file, 0o755);
  return file;
}

test('agy run killed at timeout passes when the expected skill came first', () => {
  const root = evalRepo({ ...base, name: 'tp', timeout_sec: 2, checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:plan' }] });
  const r = run(root, ['--agent', 'agy'], { AI_SDLC_AGY_BIN: hangingAgy('plan') });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS tp/);
});

test('agy run killed at timeout without any skill still fails with "quá thời gian"', () => {
  const root = evalRepo({ ...base, name: 'tn', timeout_sec: 2, checks: [{ type: 'skill_first', skill: 'ai-native-sdlc:plan' }] });
  const r = run(root, ['--agent', 'agy'], { AI_SDLC_AGY_BIN: hangingAgy(null) });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL tn: quá thời gian 2s/);
});
