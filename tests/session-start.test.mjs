import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, progress, runHook, runAgent, PLUGIN_ROOT } from './helpers.mjs';

test('injects the bootstrap skill and the status board', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}', 'sdlc/changes/c1/progress.md': progress('stage: plan\nowner: Hải') });
  const r = runHook('session-start.mjs', { cwd: root, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(ctx, /name: start/);
  assert.match(ctx, /<sdlc-status>[\s\S]*\| c1 \| plan \| Hải \|/);
});

test('suggests /ai-native-sdlc:init when the repo has no harness', () => {
  const r = runHook('session-start.mjs', { cwd: makeRepo(), hook_event_name: 'SessionStart' });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\/ai-native-sdlc:init/);
  assert.doesNotMatch(ctx, /name: start/);
});

test('a failing status board never drops the bootstrap skill', () => {
  // sdlc/changes is a regular file, so readdirSync throws ENOTDIR inside statusFor
  const root = makeRepo({ 'sdlc/config.json': '{}', 'sdlc/changes': 'not a dir' });
  const r = runHook('session-start.mjs', { cwd: root, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /name: start/);
  assert.match(ctx, /Không đọc được trạng thái SDLC/);
});

test('hooks.json registers exactly the expected events and matchers', () => {
  const { hooks } = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop']);
  const flat = (ev) => hooks[ev].map((e) => [e.matcher, e.hooks.map((h) => /hooks\/run\.mjs" --agent claude-code --event ([\w-]+)$/.exec(h.command)[1])]);
  assert.deepEqual(flat('SessionStart'), [['startup|resume|clear|compact', ['session-start']]]);
  assert.deepEqual(flat('PreToolUse'), [
    ['Edit|Write|MultiEdit|NotebookEdit', ['pre-edit']],
    ['Bash', ['pre-bash']],
  ]);
  assert.deepEqual(flat('Stop'), [[undefined, ['stop']]]);
});

test('hooks.json points at existing hook files', () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const commands = Object.values(cfg.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
  assert.equal(commands.length, 4);
  for (const c of commands) {
    assert.match(c, /hooks\/run\.mjs" --agent claude-code --event /);
    assert.ok(existsSync(join(PLUGIN_ROOT, 'hooks', 'run.mjs')));
  }
});

const GATED = JSON.stringify({ gates: [{ pattern: 'git push', reason: 'push', prefixes: [['git', 'push']] }] });
const ctxOf = (r) => r.json.hookSpecificOutput?.additionalContext ?? r.json.additionalContext ?? r.stdout;
const startEv = (root) => ({ cwd: root, hook_event_name: 'SessionStart', source: 'startup' });

test('codex context names the plugin root and uses the codex skill hint', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}' });
  const r = runAgent('codex', 'session-start', startEv(root));
  assert.equal(r.code, 0);
  const ctx = ctxOf(r);
  assert.ok(ctx.includes(`Plugin root: ${PLUGIN_ROOT}.`));
  assert.ok(ctx.includes('invoke them by name'));
  assert.ok(!ctx.includes('use the Skill tool'));
});

test('context tells each agent the name to write in Log headings (same as the Stop hook)', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}' });
  const agyCtx = (r) => r.json.injectSteps[0].systemMessage.systemMessage;
  assert.ok(ctxOf(runAgent('claude-code', 'session-start', startEv(root))).includes('### <YYYY-MM-DD> — <person> + Claude'));
  assert.ok(ctxOf(runAgent('codex', 'session-start', startEv(root))).includes('### <YYYY-MM-DD> — <person> + Codex'));
  const ev = { conversationId: 'c', workspacePaths: [root] };
  assert.ok(agyCtx(runAgent('agy', 'session-start', ev)).includes('### <YYYY-MM-DD> — <person> + Antigravity'));
});

test('claude-code context keeps the Skill tool hint and names the plugin root', () => {
  const root = makeRepo({ 'sdlc/config.json': '{}' });
  const ctx = ctxOf(runAgent('claude-code', 'session-start', startEv(root)));
  assert.ok(ctx.includes('use the Skill tool'));
  assert.ok(ctx.includes(`Plugin root: ${PLUGIN_ROOT}.`));
});

test('nudges sync-agent-files when the codex rules file is missing or stale, or AGENTS.md is missing', () => {
  const root = makeRepo({ 'sdlc/config.json': GATED, 'CLAUDE.md': 'x', 'AGENTS.md': 'x' });
  const missing = ctxOf(runAgent('codex', 'session-start', startEv(root)));
  assert.match(missing, /<sdlc-status>[\s\S]*sync-agent-files[\s\S]*<\/sdlc-status>/);
  assert.ok(missing.includes('.codex/rules/ai-native-sdlc.rules'));
  const stale = makeRepo({ 'sdlc/config.json': GATED, 'CLAUDE.md': 'x', 'AGENTS.md': 'x', '.codex/rules/ai-native-sdlc.rules': 'old\n' });
  assert.match(ctxOf(runAgent('codex', 'session-start', startEv(stale))), /sync-agent-files/);
  const noAgents = makeRepo({ 'sdlc/config.json': '{}', 'CLAUDE.md': 'x' });
  assert.match(ctxOf(runAgent('codex', 'session-start', startEv(noAgents))), /Repo thiếu\/lệch file cho agent: AGENTS\.md[\s\S]*nếu team dùng Codex\/Antigravity/);
});

test('no sync nudge when files match, nor without sdlc/config.json', () => {
  const rules = `# Generated by ai-native-sdlc from sdlc/config.json gates. Do not edit.\nprefix_rule(pattern=["git", "push"], decision="prompt", justification="push")\n`;
  const ok = makeRepo({ 'sdlc/config.json': GATED, 'CLAUDE.md': 'x', 'AGENTS.md': 'x', '.codex/rules/ai-native-sdlc.rules': rules, '.claude/agents/verifier.md': 'x', '.codex/agents/verifier.toml': 'x', '.agents/agents/verifier.md': 'x' });
  assert.doesNotMatch(ctxOf(runAgent('codex', 'session-start', startEv(ok))), /sync-agent-files/);
  assert.doesNotMatch(ctxOf(runAgent('codex', 'session-start', startEv(makeRepo()))), /sync-agent-files/);
});
