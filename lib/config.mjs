import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
  verify: {},
  protected_paths: [],
  test_globs: ['**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/tests/**'],
  gates: [],
  secret_allow: [],
  handoff_log: true,
  format_check: true,
});

const LIST_KEYS = ['protected_paths', 'test_globs', 'gates', 'secret_allow'];

const validPrefixes = (p) => Array.isArray(p) && p.every((a) => Array.isArray(a) && a.every((w) => typeof w === 'string'));

function shapeProblem(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'phải là một object JSON';
  }
  const bad = LIST_KEYS.find((k) => k in parsed && !Array.isArray(parsed[k]));
  if (bad) return `${bad} phải là một mảng`;
  if (Array.isArray(parsed.gates)) {
    const i = parsed.gates.findIndex((g) => g && typeof g === 'object' && 'prefixes' in g && !validPrefixes(g.prefixes));
    if (i >= 0) return `gates[${i}].prefixes phải là mảng các mảng chuỗi`;
  }
  return null;
}

export function loadConfig(root) {
  const path = join(root, 'sdlc', 'config.json');
  if (!existsSync(path)) return { config: null, warning: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const problem = shapeProblem(parsed);
    if (problem) {
      return { config: null, warning: `[ai-native-sdlc] sdlc/config.json sai định dạng (${problem}); guardrail tạm tắt.` };
    }
    return { config: { ...DEFAULT_CONFIG, ...parsed }, warning: null };
  } catch (e) {
    return { config: null, warning: `[ai-native-sdlc] sdlc/config.json không đọc được (${e.message}); guardrail tạm tắt.` };
  }
}
