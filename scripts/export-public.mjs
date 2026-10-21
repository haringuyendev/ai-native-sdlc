#!/usr/bin/env node
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportPublic } from '../lib/export.mjs';

const USAGE = `Dùng: node scripts/export-public.mjs <thư mục đích>
  Xuất bản commit HEAD sang thư mục đích (thường là bản clone của repo public), bỏ sdlc/changes, sdlc/lessons và mục "## SDLC harness" trong AGENTS.md.
  Mọi thứ trong thư mục đích bị thay, trừ .git. Sau đó commit và push từ thư mục đích.
`;

const target = process.argv[2];
if (!target) {
  process.stderr.write(USAGE);
  process.exit(2);
}

try {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = exportPublic(root, resolve(target));
  process.stdout.write(`Đã xuất ${files.length} file từ HEAD vào ${resolve(target)}\n`);
} catch (e) {
  process.stderr.write(`[ai-native-sdlc] export thất bại: ${e.message}\n`);
  process.exit(1);
}
