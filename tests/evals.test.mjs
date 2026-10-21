import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEval, loadEvals, parseStream, outputChecks, summarize, toolNames } from '../lib/evals.mjs';
import { makeRepo, PLUGIN_ROOT } from './helpers.mjs';

const ok = { name: 'a', description: 'd', source: 'task', prompt: 'p', checks: [{ type: 'command', run: 'true' }] };

test('validateEval accepts a minimal eval', () => {
  assert.deepEqual(validateEval(ok), []);
});

test('validateEval rejects bad shapes', () => {
  const { prompt, ...noPrompt } = ok;
  const cases = [
    noPrompt,
    { ...ok, checks: [] },
    { ...ok, checks: [{ type: 'judge' }] },
    { ...ok, source: 'other' },
    { ...ok, name: 'Bad Name' },
    { ...ok, source: 'incident' },
    { ...ok, args: 'x' },
    { ...ok, max_turns: 0 },
  ];
  for (const c of cases) assert.notDeepEqual(validateEval(c), [], JSON.stringify(c));
});

test('validateEval checks the file name', () => {
  assert.ok(validateEval({ ...ok, name: 'a' }, 'sdlc/evals/b.json').some((e) => e.includes('b')));
  assert.deepEqual(validateEval(ok, 'sdlc/evals/a.json'), []);
});

test('loadEvals reads sdlc/evals sorted and reports bad JSON', () => {
  const root = makeRepo({
    'sdlc/evals/b.json': JSON.stringify({ ...ok, name: 'b' }),
    'sdlc/evals/a.json': '{',
    'sdlc/evals/notes.md': 'x',
  });
  const r = loadEvals(root);
  assert.equal(r.length, 2);
  assert.ok(r[0].file.endsWith('a.json'));
  assert.ok(r[0].errors[0].startsWith('JSON không hợp lệ'));
  assert.deepEqual(r[1].errors, []);
  assert.deepEqual(loadEvals(makeRepo()), []);
});

const line = (o) => JSON.stringify(o);
const tool = (name, input) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

test('parseStream collects skills in order and the final result, skipping junk lines', () => {
  const text = [
    'warning: x',
    tool('Skill', { skill: 'ai-native-sdlc:intent' }),
    tool('Skill', { skill: 'ai-native-sdlc:spec' }),
    tool('Read', { file_path: '/x' }),
    line({ type: 'result', result: 'xong', is_error: false }),
  ].join('\n');
  assert.deepEqual(parseStream(text), { result: 'xong', skills: ['ai-native-sdlc:intent', 'ai-native-sdlc:spec'], isError: false, subtype: '' });
  assert.deepEqual(parseStream(''), { result: '', skills: [], isError: true, subtype: '' });
});

test('parseStream returns the result subtype', () => {
  const text = [tool('Skill', { skill: 'ai-native-sdlc:intent' }), line({ type: 'result', subtype: 'error_max_turns', is_error: true })].join('\n');
  assert.deepEqual(parseStream(text), { result: '', skills: ['ai-native-sdlc:intent'], isError: true, subtype: 'error_max_turns' });
  assert.equal(parseStream(line({ type: 'result', subtype: 'success', result: 'x', is_error: false })).subtype, 'success');
});

test('toolNames strips rule suffixes and deduplicates', () => {
  assert.equal(toolNames('Read,Edit,Bash(npm test)'), 'Read,Edit,Bash');
  assert.equal(toolNames('Read, Bash(git commit -m "a,b"),Bash(npm test),Skill(ai-native-sdlc:tdd)'), 'Read,Bash,Skill');
});

test('outputChecks grades skill and output checks, skipping command', () => {
  const parsed = { result: 'Đã tạo intent.md', skills: ['ai-native-sdlc:intent'] };
  const e = (c) => outputChecks({ checks: [c] }, parsed)[0];
  assert.equal(e({ type: 'skill_first', skill: 'ai-native-sdlc:intent' }).pass, true);
  const f = e({ type: 'skill_first', skill: 'ai-native-sdlc:spec' });
  assert.equal(f.pass, false);
  assert.ok(f.reason.includes('ai-native-sdlc:intent'));
  assert.equal(e({ type: 'skill_never', skill: 'ai-native-sdlc:intent' }).pass, false);
  assert.equal(e({ type: 'skill_never', skill: 'ai-native-sdlc:spec' }).pass, true);
  assert.equal(e({ type: 'output_includes', text: 'intent.md' }).pass, true);
  assert.equal(e({ type: 'output_excludes', text: 'intent.md' }).pass, false);
  assert.equal(outputChecks({ checks: [{ type: 'command', run: 'true' }] }, parsed).length, 0);
  const none = outputChecks({ checks: [{ type: 'skill_first', skill: 'x' }] }, { result: '', skills: [] })[0];
  assert.equal(none.pass, false);
  assert.equal(none.reason, 'không skill nào được gọi');
});

test('summarize computes pass rate', () => {
  assert.deepEqual(summarize([{ pass: true }, { pass: false }]), { passed: 1, total: 2, rate: 0.5 });
  assert.deepEqual(summarize([]), { passed: 0, total: 0, rate: 0 });
});

test('repo evals are valid and cover every trigger row', () => {
  const loaded = loadEvals(PLUGIN_ROOT);
  const bad = loaded.filter((e) => e.errors.length).map((e) => `${e.file}: ${e.errors.join('; ')}`);
  assert.deepEqual(bad, []);
  assert.ok(loaded.filter((e) => e.eval?.source === 'trigger').length >= 20);
});
