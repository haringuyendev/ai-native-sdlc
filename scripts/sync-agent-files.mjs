#!/usr/bin/env node
// Sync the files each agent needs: AGENTS.md, CLAUDE.md (@AGENTS.md), Codex rules, verifier subagents.
// Usage: node sync-agent-files.mjs [--yes] [--dry-run]. Run from (inside) the project repo.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { findRoot } from '../lib/repo.mjs';
import { loadConfig } from '../lib/config.mjs';
import { expectedAgentFiles, needsWrite } from '../lib/agent-files.mjs';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const lines = (s) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));

// Simple unified-style line diff (LCS); common lines are prefixed with a space.
export function lineDiff(oldText, newText) {
  const a = lines(oldText);
  const b = lines(newText);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push(` ${a[i++]}`), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  while (i < a.length) out.push(`-${a[i++]}`);
  while (j < b.length) out.push(`+${b[j++]}`);
  return out.join('\n');
}

// Read exactly one line from stdin ('' on EOF).
function readLine() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.once('line', (l) => (resolve(l), rl.close(), process.stdin.destroy()));
    rl.once('close', () => resolve(''));
  });
}

async function main(argv) {
  const yes = argv.includes('--yes');
  const dry = argv.includes('--dry-run');
  const root = findRoot(process.cwd());
  const { config, warning } = root ? loadConfig(root) : {};
  if (!root || !config) {
    process.stderr.write(`${warning ?? '[ai-native-sdlc] Không tìm thấy sdlc/config.json; chạy /ai-native-sdlc:init trước.'}\n`);
    return 1;
  }
  const isLink = (f) => {
    try {
      return lstatSync(join(root, f.path)).isSymbolicLink();
    } catch {
      return false;
    }
  };
  const wanted = expectedAgentFiles(root, config, PLUGIN_ROOT).filter((f) => needsWrite(root, f));
  // Never write through a symlink (dangling or not): skip and report it.
  const todo = wanted.filter((f) => !isLink(f));
  const skipped = wanted.filter(isLink);
  if (skipped.length > 0) {
    process.stdout.write(`Bỏ qua (symlink, không ghi xuyên qua): ${skipped.map((f) => f.path).join(', ')}\n`);
  }
  if (todo.length === 0) {
    process.stdout.write('Các file cho agent đã đủ và khớp.\n');
    return 0;
  }
  for (const f of todo) {
    const abs = join(root, f.path);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    process.stdout.write(`--- ${f.path}${before === '' ? ' (mới)' : ''}\n${lineDiff(before, f.content)}\n\n`);
  }
  if (dry) return 1;
  if (!yes) {
    process.stdout.write('Ghi các file trên? (y/N) ');
    const answer = (await readLine()).trim();
    if (!/^y$/i.test(answer)) {
      process.stdout.write('\nKhông ghi gì.\n');
      return 0;
    }
  }
  for (const f of todo) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
  process.stdout.write(`Đã ghi ${todo.length} file: ${todo.map((f) => f.path).join(', ')}\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
