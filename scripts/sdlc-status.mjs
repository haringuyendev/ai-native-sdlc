#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { openChanges } from '../lib/changes.mjs';
import { findRoot } from '../lib/repo.mjs';

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';

export function renderStatus(changes) {
  if (changes.length === 0) return '## SDLC: không có change nào đang mở\n';
  const rows = changes.map((c) => {
    const d = c.data;
    const tasks = c.tasks.total ? `${c.tasks.done}/${c.tasks.total}` : '';
    const blocked = typeof d.blocked_by === 'string' ? d.blocked_by : '';
    return `| ${cell(c.slug)} | ${cell(d.stage)} | ${cell(d.owner)} | ${cell(tasks)} | ${cell(d.next)} | ${cell(blocked)} | ${cell(c.updated)} |`;
  });
  return [
    `## SDLC: ${changes.length} change đang mở`,
    '',
    '| Change | Stage | Owner | Tasks | Next | Blocked | Cập nhật |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

export function statusFor(cwd) {
  const root = findRoot(cwd);
  return root ? renderStatus(openChanges(root)) : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = statusFor(process.argv[2] ?? process.cwd());
  process.stdout.write(out ?? 'Repo chưa có harness SDLC (thiếu sdlc/config.json). Chạy /ai-native-sdlc:init.\n');
}
