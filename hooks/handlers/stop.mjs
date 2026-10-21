import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../lib/config.mjs';
import { findRoot, headSha } from '../../lib/repo.mjs';
import { openChanges } from '../../lib/changes.mjs';
import { saveBaseline, progressHashes, touchedFiles } from '../../lib/session.mjs';
import { validateChange } from '../../lib/validate.mjs';

const ALLOW = { type: 'allow' };

export function stop(ev, adapter) {
  const root = findRoot(ev.cwd);
  if (!root) return ALLOW;
  const { config } = loadConfig(root);
  if (!config) return ALLOW;
  const open = openChanges(root);
  let state;
  try {
    state = touchedFiles(root, ev.sessionId);
  } catch (e) {
    process.stderr.write(`[ai-native-sdlc] không đọc được git status: ${e?.message ?? String(e)}\n`);
    return ALLOW;
  }
  if (!ev.alreadyContinued && config.handoff_log !== false) {
    const reminder = handoffReminder(ev, adapter, root, open, state);
    if (reminder) return reminder;
  }
  if (config.format_check === false) return ALLOW;
  return formatCheck(ev, root, open, state);
}

function handoffReminder(ev, adapter, root, open, { touched, files, baseline }) {
  const active = open.filter((c) => ['build', 'review'].includes(c.data.stage));
  if (active.length === 0) return null;
  let codeChanged;
  let progressTouched;
  let remindKey = null;
  if (baseline) {
    const code = touched.filter((f) => !f.startsWith('sdlc/'));
    codeChanged = code.length > 0;
    remindKey = createHash('sha1').update(JSON.stringify([code.sort(), headSha(root)])).digest('hex');
    const now = progressHashes(root);
    progressTouched = active.some((c) => {
      const key = `sdlc/changes/${c.slug}/progress.md`;
      return now[key] !== (baseline.progress ?? {})[key];
    });
  } else {
    codeChanged = files.some((f) => !f.startsWith('sdlc/'));
    progressTouched = active.some((c) => files.includes(`sdlc/changes/${c.slug}/progress.md`));
  }
  if (!codeChanged || progressTouched) return null;
  if (remindKey && baseline.remindedFor === remindKey) return null;
  if (remindKey) {
    try {
      saveBaseline(ev.sessionId, { ...baseline, remindedFor: remindKey });
    } catch {
      // best-effort: worst case the reminder repeats
    }
  }
  const slugs = active.map((c) => c.slug).join(', ');
  return {
    type: 'continue',
    reason: `[ai-native-sdlc] Trước khi dừng: thêm mục "### <YYYY-MM-DD> — <người> + ${adapter.displayName}" vào phần ## Log trong progress.md của change đang làm (${slugs}): đã làm gì, commit nào, còn dở gì, rủi ro. Cập nhật trường next và tick checkbox trong plan.md.`,
  };
}

function formatCheck(ev, root, open, { touched, baseline }) {
  const slugs = new Set(touched.map((f) => /^sdlc\/changes\/([^/]+)\//.exec(f)?.[1]).filter(Boolean));
  const lines = [];
  for (const c of open.filter((x) => slugs.has(x.slug))) {
    for (const e of validateChange(join(root, 'sdlc', 'changes', c.slug))) {
      lines.push(`- sdlc/changes/${c.slug}/${e.file}${e.line ? `:${e.line}` : ''}: ${e.message}`);
    }
  }
  if (lines.length === 0) return ALLOW;
  const text = `[ai-native-sdlc] Artifact sai định dạng, sửa trước khi dừng để agent khác hoặc phiên sau làm tiếp được:\n${lines.join('\n')}`;
  // The format check gets its own one hold per distinct error set, even when the
  // previous hold in this chain was the handoff reminder (which sets remindedFor).
  const key = createHash('sha1').update(text).digest('hex');
  const heldBefore = baseline?.formatHeldFor === key;
  const afterReminder = Boolean(baseline?.remindedFor);
  if (ev.alreadyContinued && (!baseline || heldBefore || !afterReminder)) {
    process.stderr.write(`${text}\n`);
    return ALLOW;
  }
  if (baseline) {
    try {
      saveBaseline(ev.sessionId, { ...baseline, formatHeldFor: key });
    } catch {
      // best-effort: worst case the hold repeats once
    }
  }
  return { type: 'continue', reason: text };
}
