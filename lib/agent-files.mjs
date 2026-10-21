// Files the harness expects in a repo so Codex/Antigravity/Claude Code all work. Read-only helpers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRules, RULES_PATH } from './codex-rules.mjs';

const VERIFIERS = [
  ['.claude/agents/verifier.md', 'verifier.md'],
  ['.codex/agents/verifier.toml', 'verifier.toml'],
  ['.agents/agents/verifier.md', 'verifier.agy.md'],
];

const read = (p) => readFileSync(p, 'utf8');

// Each entry: { path, content, overwrite? }. `overwrite` marks an existing file that sync replaces
// (CLAUDE.md moving its content into AGENTS.md); the generated rules file is also replaced when stale.
export function expectedAgentFiles(root, config, pluginRoot) {
  const files = [];
  if ((config?.gates ?? []).some((g) => (g.prefixes ?? []).length > 0)) {
    files.push({ path: RULES_PATH, content: renderRules(config.gates) });
  }
  const claudePath = join(root, 'CLAUDE.md');
  const claude = existsSync(claudePath) ? read(claudePath) : null;
  const importLine = '@AGENTS.md\n';
  const hasContent = claude !== null && claude.trim() !== '' && claude.trim() !== importLine.trim();
  const agentsContent = hasContent ? claude : read(join(pluginRoot, 'templates', 'AGENTS.md'));
  files.push({ path: 'AGENTS.md', content: agentsContent });
  if (claude === null) files.push({ path: 'CLAUDE.md', content: importLine });
  else if (claude.trim() === '') files.push({ path: 'CLAUDE.md', content: importLine, overwrite: true });
  else if (hasContent && !existsSync(join(root, 'AGENTS.md'))) {
    files.push({ path: 'CLAUDE.md', content: importLine, overwrite: true });
  }
  for (const [path, tpl] of VERIFIERS) {
    files.push({ path, content: read(join(pluginRoot, 'templates', 'agents', tpl)) });
  }
  return files;
}

// Does this entry need writing? Absent files, a stale rules file, or an explicit overwrite.
export function needsWrite(root, { path, content, overwrite }) {
  const abs = join(root, path);
  if (!existsSync(abs)) return true;
  if (overwrite) return true;
  if (path !== RULES_PATH) return false;
  try {
    return read(abs) !== content;
  } catch {
    return true;
  }
}

// Is the generated Codex rules file present and identical to what the config renders?
export function rulesInSync(root, config) {
  const file = join(root, RULES_PATH);
  try {
    return existsSync(file) && read(file) === renderRules(config.gates);
  } catch {
    return false;
  }
}

// Paths that are missing, or (for the generated rules file) out of date.
export function missingOrStale(root, config, pluginRoot) {
  return expectedAgentFiles(root, config, pluginRoot)
    .filter((f) => !f.overwrite && needsWrite(root, f))
    .map((f) => f.path);
}
