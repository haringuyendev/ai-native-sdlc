import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

export const CLOSED_STAGES = ['done', 'dropped'];

export function stripFences(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join('\n');
}

export function countTasks(rawText) {
  const text = stripFences(rawText);
  const done = (text.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
  const open = (text.match(/^\s*[-*] \[ \]/gm) || []).length;
  return { done, total: done + open };
}

// A bounded change has no plan.md: its plan is the "## Plan" section of progress.md.
export function planSection(body) {
  const lines = stripFences(body).split('\n');
  const start = lines.findIndex((l) => /^## Plan\s*$/.test(l));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

export function lastLogDate(rawBody) {
  const dates = [...stripFences(rawBody).matchAll(/^###\s+(\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]).sort();
  return dates.at(-1) ?? '';
}

export function listChanges(root) {
  const base = join(root, 'sdlc', 'changes');
  if (!existsSync(base)) return [];
  const result = [];
  for (const d of readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(join(base, d.name, 'progress.md'))) continue;
    try {
      const dir = join(base, d.name);
      const { data, body } = parseFrontmatter(readFileSync(join(dir, 'progress.md'), 'utf8'));
      const planPath = join(dir, 'plan.md');
      const tasks = countTasks(existsSync(planPath) ? readFileSync(planPath, 'utf8') : planSection(body));
      result.push({ slug: d.name, dir, data, body, tasks, updated: lastLogDate(body) });
    } catch (e) {
      process.stderr.write(`[ai-native-sdlc] bỏ qua ${d.name}: ${e?.message ?? String(e)}\n`);
    }
  }
  return result.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function openChanges(root) {
  return listChanges(root).filter((c) => !CLOSED_STAGES.includes(c.data.stage));
}
