import { loadConfig } from '../../lib/config.mjs';
import { findRoot, toRepoPath } from '../../lib/repo.mjs';
import { openChanges } from '../../lib/changes.mjs';
import { matchesAny } from '../../lib/glob.mjs';
import { checkProtected, checkTestLock, checkSecrets } from '../../lib/guards.mjs';

export function preEdit(ev) {
  const root = findRoot(ev.cwd);
  if (!root) return { type: 'allow' };
  const { config, warning } = loadConfig(root);
  if (!config) {
    if (warning) process.stderr.write(`${warning}\n`);
    return { type: 'allow' };
  }
  const allowed = new Set();
  const locked = openChanges(root).filter((c) => c.data.test_lock === true).map((c) => c.slug);
  for (const f of ev.files) {
    if (!f.path) continue;
    const repoPath = toRepoPath(root, f.path);
    if (repoPath.startsWith('..')) continue;
    if (matchesAny(repoPath, config.secret_allow)) allowed.add(f);
    const reason = checkProtected(repoPath, config) ?? checkTestLock(repoPath, config, locked);
    if (reason) return { type: 'deny', reason };
  }
  for (const f of ev.files) {
    if (allowed.has(f)) continue;
    const secret = checkSecrets(f.newText ?? '');
    if (secret) return { type: 'deny', reason: secret };
  }
  return { type: 'allow' };
}
