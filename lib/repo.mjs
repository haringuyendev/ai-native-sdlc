import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export function findRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'sdlc', 'config.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function toRepoPath(root, file) {
  const abs = isAbsolute(file) ? file : join(root, file);
  return relative(root, abs).split(sep).join('/');
}

// -z output is NUL-separated and never C-quotes paths. A rename/copy record
// is followed by one extra field holding the original path, which is skipped.
export function changedFiles(root) {
  const out = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  const fields = out.split('\0');
  const files = [];
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i];
    if (!rec) continue;
    const xy = rec.slice(0, 2);
    files.push(rec.slice(3));
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') i++;
  }
  return files;
}

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbc15904';

export function isAncestor(root, sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function headSha(root) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function filesChangedSince(root, sha) {
  // The empty tree is not always a readable object (git 2.53 rejects it), so list HEAD's files instead.
  const args = sha === EMPTY_TREE ? ['ls-tree', '-r', '--name-only', '-z', 'HEAD'] : ['diff', '--name-only', '-z', sha, 'HEAD'];
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return out.split('\0').filter(Boolean);
}

// Content hash of each working file ('deleted' when it is gone). Best-effort: {} when git fails.
export function hashFiles(root, paths) {
  const out = {};
  const present = [];
  for (const p of paths) {
    if (existsSync(join(root, p))) present.push(p);
    else out[p] = 'deleted';
  }
  if (present.length === 0) return out;
  try {
    const res = execFileSync('git', ['hash-object', '--', ...present], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const hashes = res.split('\n').filter(Boolean);
    present.forEach((p, i) => {
      if (hashes[i]) out[p] = hashes[i];
    });
  } catch {
    // best-effort
  }
  return out;
}
