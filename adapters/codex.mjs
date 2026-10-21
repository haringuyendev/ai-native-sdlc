// Codex adapter: same stdin/stdout contract as Claude except apply_patch edits and no "ask".

import { isAbsolute, resolve } from 'node:path';
import claudeCode from './claude-code.mjs';
import { parseApplyPatch } from '../lib/patch.mjs';
import { skillsFromCommand, jsonLines, unique } from './eval-util.mjs';

const abs = (cwd, p) => (isAbsolute(p) ? p : resolve(cwd, p));
const DEFAULT_MODEL = 'gpt-6-luna';

export default {
  name: 'codex',
  displayName: 'Codex',
  skillHint: 'For all other skills, invoke them by name ($<name>, or ai-native-sdlc:<name> if namespaced).',

  // No turn cap in `codex exec`: a run killed at the eval timeout is graded on its partial stream.
  gradePartialOnTimeout: true,

  // Workspace-write sandbox (checks may write in the throwaway worktree) and trusted hooks, like a user who accepted them; the eval's allowed_tools/args are Claude-only and ignored here.
  evalCommand({ prompt }) {
    return {
      bin: process.env.AI_SDLC_CODEX_BIN || 'codex',
      argv: ['exec', '--json', '-s', 'workspace-write', '-m', process.env.AI_SDLC_CODEX_MODEL || DEFAULT_MODEL, '--dangerously-bypass-hook-trust', '--skip-git-repo-check', prompt],
    };
  },

  // Codex has no skill event in `exec --json`: a skill shows up as a shell read of
  // .../skills/<name>/SKILL.md, or (when invoked explicitly) as the agent naming "ai-native-sdlc:<name>".
  parseEvalStream(stdout) {
    const skills = [];
    let result = '';
    let completed = false;
    let failed = false;
    for (const msg of jsonLines(stdout)) {
      if (msg.type === 'turn.completed') completed = true;
      else if (msg.type === 'turn.failed') failed = true;
      else if (msg.type === 'item.completed' && msg.item) {
        const { item } = msg;
        if (item.type === 'command_execution') {
          skills.push(...skillsFromCommand(item.command));
        } else if (item.type === 'agent_message' && typeof item.text === 'string') {
          result = item.text;
        }
      }
    }
    return { result, skills: unique(skills), isError: failed || !completed, subtype: failed ? 'turn.failed' : completed ? 'turn.completed' : '' };
  },

  parse(event, raw) {
    if (event !== 'pre-edit') return claudeCode.parse(event, raw);
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(raw.tool_name) || (raw.tool_name !== 'apply_patch' && raw.tool_input?.file_path)) {
      return claudeCode.parse(event, raw);
    }
    if (raw.tool_name && raw.tool_name !== 'apply_patch') return null;
    const cwd = raw.cwd ?? process.cwd();
    const files = [];
    for (const f of parseApplyPatch(raw.tool_input?.command)) {
      const newText = f.op === 'delete' ? '' : f.added;
      files.push({ path: abs(cwd, f.path), newText });
      if (f.moveTo) files.push({ path: abs(cwd, f.moveTo), newText });
    }
    return { kind: 'edit', cwd, sessionId: raw.session_id, files };
  },

  allowOutput: () => ({ stdout: '{}', code: 0 }),

  render(result) {
    if (result.type === 'ask') {
      return { stderr: `${result.reason} Codex không hỏi được ở bước này: hãy để người dùng tự chạy lệnh.\n`, code: 2 };
    }
    // Codex requires JSON on stdout when exiting 0 (Stop treats plain text/empty as invalid).
    if (result.type === 'allow') return { stdout: '{}', code: 0 };
    return claudeCode.render(result);
  },
};
