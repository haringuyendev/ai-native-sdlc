import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

// The repo dogfoods the harness: sdlc/changes and sdlc/lessons hold its own
// work log and stay private. config.json and evals/ ship so the public copy
// still passes sdlc-check and its trigger evals can be run.
const PRIVATE = [/^sdlc\/changes\//, /^sdlc\/lessons\//];
const isPublic = (path) => !PRIVATE.some((re) => re.test(path));

export function stripSection(md, heading) {
  const lines = md.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return md;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

const TRANSFORMS = { 'AGENTS.md': (text) => stripSection(text, 'SDLC harness') };

// Writes the committed HEAD of `root` into `outDir`, replacing everything
// there except .git so the target can be a clone of the public repo.
export function exportPublic(root, outDir) {
  const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  const files = git('ls-tree', '-r', '-z', '--name-only', 'HEAD').toString('utf8').split('\0').filter(Boolean).filter(isPublic);

  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(outDir)) if (name !== '.git') rmSync(join(outDir, name), { recursive: true, force: true });

  for (const path of files) {
    let content = git('show', `HEAD:${path}`);
    if (TRANSFORMS[path]) content = TRANSFORMS[path](content.toString('utf8'));
    const abs = join(outDir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return files;
}
