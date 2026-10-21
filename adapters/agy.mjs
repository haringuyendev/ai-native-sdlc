// Antigravity (agy) adapter. A failing hook BLOCKS the action on agy, so render never exits non-zero.

import { skillFromPath, jsonLines, unique } from './eval-util.mjs';

const json = (obj) => JSON.stringify(obj);
const EDIT_TOOLS = ['write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content'];

const str = (v) => (typeof v === 'string' ? v : undefined);

function editedText(a) {
  const parts = [a.Content, a.CodeContent, a.Replacement, a.ReplacementContent];
  for (const c of a.ReplacementChunks ?? []) parts.push(c?.ReplacementContent);
  return parts.filter((p) => typeof p === 'string').join('\n');
}

export default {
  name: 'agy',
  displayName: 'Antigravity',
  skillHint: 'For all other skills, use /<name> (skills are slash commands).',

  // Headless agy auto-denies shell commands (nothing can approve them), so evals skip permissions; they run
  // only in the runner's throwaway worktree and our PreToolUse hooks still deny (a hook "ask" is auto-approved).
  // No turn cap in `agy -p`: a run killed at the eval timeout is graded on its partial stream.
  gradePartialOnTimeout: true,

  evalCommand({ prompt, timeoutSec }) {
    const model = process.env.AI_SDLC_AGY_MODEL;
    return {
      bin: process.env.AI_SDLC_AGY_BIN || 'agy',
      argv: ['-p', prompt, '--output-format', 'stream-json', '--print-timeout', `${timeoutSec}s`, '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])],
    };
  },

  // agy has no skill event: a skill shows up as a file-read tool step on .../skills/<name>/SKILL.md.
  parseEvalStream(stdout) {
    const skills = [];
    let result = '';
    let status = '';
    for (const msg of jsonLines(stdout)) {
      if (msg.event === 'step_update') {
        const s = msg.step_update;
        const p = s?.tool_info?.parameters;
        if (s?.step_type === 'tool' && p && ['view_file', 'read_file'].includes(s.tool_name)) skills.push(...skillFromPath(` ${p.Path ?? p.AbsolutePath ?? p.TargetFile ?? ''}`));
      } else if (msg.event === 'result') {
        result = typeof msg.result?.response === 'string' ? msg.result.response : '';
        status = typeof msg.result?.status === 'string' ? msg.result.status : '';
      }
    }
    return { result, skills: unique(skills), isError: status !== 'SUCCESS', subtype: status.toLowerCase() };
  },

  parse(event, raw) {
    const args = raw.toolCall?.args ?? {};
    const base = { cwd: str(args.Cwd) ?? raw.workspacePaths?.[0] ?? process.cwd(), sessionId: raw.conversationId };
    switch (event) {
      case 'session-start':
        return { kind: 'session-start', ...base, cwd: raw.workspacePaths?.[0] ?? process.cwd(), source: raw.source };
      case 'pre-edit': {
        if (!EDIT_TOOLS.includes(raw.toolCall?.name)) return null;
        const path = str(args.Path) ?? str(args.TargetFile);
        if (!path) return null;
        return { kind: 'edit', ...base, files: [{ path, newText: editedText(args) }] };
      }
      case 'pre-bash':
        if (raw.toolCall?.name && raw.toolCall.name !== 'run_command') return null;
        return { kind: 'bash', ...base, command: str(args.CommandLine) ?? '' };
      case 'stop':
        return { kind: 'stop', ...base, cwd: raw.workspacePaths?.[0] ?? process.cwd(), alreadyContinued: Number(raw.executionNum) > 0 };
      default:
        return null;
    }
  },

  allowOutput: () => ({ stdout: json({ decision: 'allow' }), code: 0 }),

  render(result) {
    switch (result.type) {
      case 'deny':
        return { stdout: json({ decision: 'deny', reason: result.reason }), code: 0 };
      case 'ask':
        return { stdout: json({ decision: 'ask', reason: result.reason }), code: 0 };
      case 'context':
        return { stdout: json({ injectSteps: [{ systemMessage: { systemMessage: result.text } }] }), code: 0 };
      case 'continue':
        return { stdout: json({ decision: 'continue', reason: result.reason }), code: 0 };
      default:
        return { stdout: json({ decision: 'allow' }), code: 0 };
    }
  },
};
