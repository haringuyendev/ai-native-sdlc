import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

export const defaultCodexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// `[projects."<path>"]` sections of a Codex config.toml → { path: trust_level }.
function projectTrust(toml) {
  const out = {};
  let current = null;
  for (const line of toml.split('\n')) {
    const header = /^\s*\[(.*)\]\s*$/.exec(line);
    if (header) {
      const m = /^projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')$/.exec(header[1].trim());
      current = m ? (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]) : null;
      continue;
    }
    const level = current && /^\s*trust_level\s*=\s*"([^"]*)"/.exec(line);
    if (level) out[current] = level[1];
  }
  return out;
}

// Codex reads a project's .codex/rules only when the project is trusted. The closest
// [projects."…"] entry at or above root decides; no entry or no readable config = untrusted.
export function codexProjectTrusted(root, codexHome = defaultCodexHome()) {
  let toml;
  try {
    toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  } catch {
    return false;
  }
  const target = real(root);
  let best = null;
  for (const [path, level] of Object.entries(projectTrust(toml))) {
    const p = real(path);
    if ((target === p || target.startsWith(p.endsWith(sep) ? p : p + sep)) && (!best || p.length > best.p.length)) {
      best = { p, level };
    }
  }
  return best?.level === 'trusted';
}
