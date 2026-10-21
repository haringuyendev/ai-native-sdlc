// Shared helpers for the per-agent eval stream parsers.

const PREFIX = 'ai-native-sdlc:';
const READ_PROGRAMS = new Set(['cat', 'sed', 'head', 'tail', 'less', 'nl', 'bat']);
// start is injected by the SessionStart hook, so reading it is not a routing choice.
const IGNORED = new Set(['start']);
const SKILL_PATH = /(?:^|[\s"'=])[^\s"']*\/ai-native-sdlc\/(?:[^\s"']*\/)?skills\/([A-Za-z0-9_-]+)\/SKILL\.md/g;

// "ai-native-sdlc:intent" -> "intent"
export const shortSkill = (name) => (String(name).startsWith(PREFIX) ? String(name).slice(PREFIX.length) : String(name));

// Skill names whose SKILL.md lives under an `ai-native-sdlc` path segment (other skills are not ours).
export function skillFromPath(text) {
  const names = [];
  for (const m of String(text ?? '').matchAll(SKILL_PATH)) if (!IGNORED.has(m[1])) names.push(m[1]);
  return names;
}

// Skills read by a shell command: only when the segment's program is a read-like one.
export function skillsFromCommand(command) {
  const names = [];
  const text = String(command ?? '').replace(/^\s*\S*sh\s+-\w+\s+["']?/, '');
  for (const seg of text.split(/&&|\|\||;|\||\n/)) {
    const words = seg.trim().split(/\s+/).filter((w) => !/^\w+=/.test(w));
    const prog = (words[0] ?? '').replace(/^.*\//, '');
    if (READ_PROGRAMS.has(prog)) names.push(...skillFromPath(` ${words.slice(1).join(' ')}`));
  }
  return names;
}

export function jsonLines(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    try {
      const msg = JSON.parse(line);
      if (msg && typeof msg === 'object') out.push(msg);
    } catch {
      // not JSON: banner or noise
    }
  }
  return out;
}

// Keeps the first occurrence of each name, in order.
export const unique = (names) => [...new Set(names)];
