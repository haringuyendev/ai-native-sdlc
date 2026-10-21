import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statusFor } from '../../scripts/sdlc-status.mjs';
import { findRoot, headSha, changedFiles, hashFiles } from '../../lib/repo.mjs';
import { loadConfig } from '../../lib/config.mjs';
import { missingOrStale } from '../../lib/agent-files.mjs';
import { saveBaseline, loadBaseline, progressHashes } from '../../lib/session.mjs';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const NO_HARNESS =
  '<sdlc-status>Repo chưa có harness SDLC (thiếu sdlc/config.json). Nếu đây là repo dự án của team, gợi ý người dùng chạy /ai-native-sdlc:init.</sdlc-status>';

function syncNudge(cwd) {
  try {
    const root = findRoot(cwd);
    const { config } = root ? loadConfig(root) : {};
    if (!config) return '';
    const paths = missingOrStale(root, config, PLUGIN_ROOT);
    if (paths.length === 0) return '';
    return `Repo thiếu/lệch file cho agent: ${paths.join(', ')}. Tùy chọn, bỏ qua nếu team chỉ dùng một agent; nếu team dùng Codex/Antigravity, chạy: node "${join(PLUGIN_ROOT, 'scripts', 'sync-agent-files.mjs')}"\n`;
  } catch (e) {
    process.stderr.write(`[ai-native-sdlc] không kiểm tra được file agent: ${e?.message ?? e}\n`);
    return '';
  }
}

export function sessionStart(ev, adapter) {
  let status;
  let statusBlock;
  try {
    status = statusFor(ev.cwd);
  } catch (e) {
    statusBlock = `<sdlc-status>Không đọc được trạng thái SDLC: ${e?.message ?? String(e)}</sdlc-status>`;
  }
  if (statusBlock === undefined && !status) return { type: 'context', text: NO_HARNESS };
  try {
    const root = findRoot(ev.cwd);
    const keep = ev.source === 'compact' && ev.sessionId && loadBaseline(ev.sessionId)?.root === root;
    if (root && ev.sessionId && !keep) {
      const dirty = changedFiles(root);
      saveBaseline(ev.sessionId, { root, head: headSha(root), dirty, dirtyHashes: hashFiles(root, dirty), progress: progressHashes(root) });
    }
  } catch {
    // Baseline is best-effort; the Stop hook falls back to git status without it.
  }
  statusBlock ??= `<sdlc-status>\n${status}${syncNudge(ev.cwd)}</sdlc-status>`;
  const skill = readFileSync(join(PLUGIN_ROOT, 'skills', 'start', 'SKILL.md'), 'utf8');
  const text = [
    '<EXTREMELY_IMPORTANT>',
    `You have the ai-native-sdlc harness. Plugin root: ${PLUGIN_ROOT}. Below is the full content of the 'ai-native-sdlc:start' skill. ${adapter.skillHint} Your agent name is ${adapter.displayName}: progress.md Log headings are \`### <YYYY-MM-DD> — <person> + ${adapter.displayName}\`.`,
    '',
    skill,
    '</EXTREMELY_IMPORTANT>',
    '',
    statusBlock,
  ].join('\n');
  return { type: 'context', text };
}
