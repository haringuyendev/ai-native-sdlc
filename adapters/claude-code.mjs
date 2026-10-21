// Claude Code adapter: maps Claude's hook stdin/stdout contract to the neutral Event/Result.

import { editedText } from '../lib/guards.mjs';
import { shortSkill, jsonLines } from './eval-util.mjs';

const json = (obj) => JSON.stringify(obj);

// Parses `claude -p --output-format stream-json`; skill names stay as Claude prints them (namespaced).
export function parseStream(text) {
  const skills = [];
  let result = '';
  let isError = true;
  let subtype = '';
  for (const msg of jsonLines(text)) {
    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const part of msg.message.content) {
        if (part?.type === 'tool_use' && part.name === 'Skill' && typeof part.input?.skill === 'string') skills.push(part.input.skill);
      }
    } else if (msg.type === 'result') {
      result = typeof msg.result === 'string' ? msg.result : '';
      isError = msg.is_error === true;
      subtype = typeof msg.subtype === 'string' ? msg.subtype : '';
    }
  }
  return { result, skills, isError, subtype };
}

// Tool names for `claude --tools` from an --allowedTools rule list: "Read,Bash(npm test)" -> "Read,Bash".
export function toolNames(allowedTools) {
  const names = String(allowedTools)
    .replace(/\([^)]*\)/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
  return [...new Set(names)].join(',');
}

export default {
  name: 'claude-code',
  displayName: 'Claude',
  skillHint: 'For all other skills, use the Skill tool (ai-native-sdlc:<name>).',

  evalCommand({ prompt, maxTurns, allowedTools, args = [], pluginDir }) {
    return {
      bin: process.env.AI_SDLC_CLAUDE_BIN || 'claude',
      argv: [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', String(maxTurns),
        ...(allowedTools ? ['--tools', toolNames(allowedTools), '--allowedTools', allowedTools] : []),
        ...(pluginDir !== undefined ? ['--plugin-dir', pluginDir] : []),
        '--permission-mode', 'dontAsk',
        ...args,
      ],
    };
  },

  parseEvalStream(stdout) {
    const p = parseStream(stdout);
    return { ...p, skills: p.skills.map(shortSkill) };
  },

  parse(event, raw) {
    const base = { cwd: raw.cwd ?? process.cwd(), sessionId: raw.session_id };
    switch (event) {
      case 'session-start':
        return { kind: 'session-start', ...base, source: raw.source };
      case 'pre-edit': {
        const ti = raw.tool_input ?? {};
        return { kind: 'edit', ...base, files: [{ path: ti.file_path ?? ti.notebook_path, newText: editedText(ti) }] };
      }
      case 'pre-bash':
        return { kind: 'bash', ...base, command: raw.tool_input?.command ?? '' };
      case 'stop':
        return { kind: 'stop', ...base, alreadyContinued: Boolean(raw.stop_hook_active) };
      default:
        return null;
    }
  },

  allowOutput: () => ({ stdout: '', code: 0 }),

  render(result) {
    switch (result.type) {
      case 'deny':
        return { stderr: `${result.reason}\n`, code: 2 };
      case 'ask':
        return { stdout: json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: result.reason } }), code: 0 };
      case 'context':
        return { stdout: json({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: result.text } }), code: 0 };
      case 'continue':
        return { stdout: json({ decision: 'block', reason: result.reason }), code: 0 };
      default:
        return { code: 0 };
    }
  },
};
