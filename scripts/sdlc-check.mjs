#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { findRoot } from '../lib/repo.mjs';
import { openChanges } from '../lib/changes.mjs';
import { validateChange } from '../lib/validate.mjs';

// No slug: check open changes (like Stop). With a slug: check that change at any stage.
export function checkRepo(root, slug) {
  let slugs;
  if (slug) {
    if (!existsSync(join(root, 'sdlc', 'changes', slug))) return { lines: [`Không tìm thấy change: ${slug}`], failed: true };
    slugs = [slug];
  } else {
    slugs = openChanges(root).map((c) => c.slug);
  }
  const lines = [];
  for (const s of slugs) {
    for (const e of validateChange(join(root, 'sdlc', 'changes', s))) {
      lines.push(`sdlc/changes/${s}/${e.file}${e.line ? `:${e.line}` : ''} ${e.message}`);
    }
  }
  return { lines, failed: lines.length > 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = findRoot(process.cwd());
  if (!root) {
    process.stderr.write('Repo chưa có harness SDLC (thiếu sdlc/config.json). Chạy /ai-native-sdlc:init.\n');
    process.exit(1);
  }
  const { lines, failed } = checkRepo(root, process.argv[2]);
  process.stdout.write(failed ? lines.join('\n') + '\n' : 'OK\n');
  process.exit(failed ? 1 : 0);
}
