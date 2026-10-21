import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listChanges } from './changes.mjs';
import { changedFiles, filesChangedSince, headSha, isAncestor, hashFiles, EMPTY_TREE } from './repo.mjs';

// Per-session baseline for the Stop hook. Lives outside the repo: hooks never write into it.
export function stateDir() {
  return process.env.AI_SDLC_STATE_DIR || join(tmpdir(), `ai-native-sdlc-${process.getuid?.() ?? 'user'}`, 'sessions');
}

export function baselinePath(sessionId) {
  return join(stateDir(), `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

export function progressHashes(root) {
  const out = {};
  for (const c of listChanges(root)) {
    out[`sdlc/changes/${c.slug}/progress.md`] = createHash('sha1').update(readFileSync(join(c.dir, 'progress.md'))).digest('hex');
  }
  return out;
}

export function saveBaseline(sessionId, baseline) {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  writeFileSync(baselinePath(sessionId), JSON.stringify(baseline), { mode: 0o600 });
  pruneOld();
}

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function pruneOld() {
  try {
    const dir = stateDir();
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const f = join(dir, name);
        if (statSync(f).mtimeMs < cutoff) unlinkSync(f);
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}

export function loadBaseline(sessionId) {
  try {
    return JSON.parse(readFileSync(baselinePath(sessionId), 'utf8'));
  } catch {
    return null;
  }
}

// Files touched in this session: baseline-relative when a baseline exists for
// this root, otherwise whatever git status reports. `files` is the raw git status list.
export function touchedFiles(root, sessionId) {
  const files = changedFiles(root);
  const baseline = sessionId ? loadBaseline(sessionId) : null;
  if (!baseline || baseline.root !== root) return { touched: files, files, baseline: null };
  let committed = [];
  const from = baseline.head ?? (headSha(root) ? EMPTY_TREE : null);
  if (from && (from === EMPTY_TREE || isAncestor(root, from))) {
    try {
      committed = filesChangedSince(root, from);
    } catch {
      committed = [];
    }
  }
  const before = new Set(baseline.dirty ?? []);
  const dirtyNow = files.filter((f) => before.has(f));
  const nowHashes = hashFiles(root, dirtyNow);
  const was = baseline.dirtyHashes ?? {};
  const edited = dirtyNow.filter((f) => was[f] !== undefined && nowHashes[f] !== undefined && was[f] !== nowHashes[f]);
  const gone = [...before].filter((f) => !files.includes(f) && was[f] !== undefined && !existsSync(join(root, f)) && was[f] !== 'deleted');
  const touched = [...new Set([...committed, ...files.filter((f) => !before.has(f)), ...edited, ...gone])];
  return { touched, files, baseline };
}
