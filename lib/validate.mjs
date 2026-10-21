import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { touchedFiles } from './session.mjs';

export const STAGES = ['intent', 'spec', 'plan', 'build', 'review', 'done', 'dropped'];
export const LOG_HEADING = /^### \d{4}-\d{2}-\d{2} — .+ \+ .+$/;
// Source of truth: templates/*.md.
export const REQUIRED_HEADINGS = {
  'intent.md': ['## Problem', '## Proposed outcome', '## Affected users and systems', '## Constraints', '## Open questions'],
  'spec.md': ['## Requirements', '## Design', '## Policies applied', '## Flagged concerns', '## Answers to open questions', '## Out of scope'],
  'plan.md': ['## Files that change', '## Order of work', '## Risks', '## Proof'],
  'review.md': ['## Findings', '## Declined to judge', '## Verdict'],
};

// Lines outside fenced code blocks, keeping 1-based line numbers.
function unfenced(text) {
  const out = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (!inFence) out.push({ n: i + 1, text: line });
  });
  return out;
}

const hasHeading = (lines, h) => lines.some((l) => l.text.trimEnd() === h);
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const blank = (v) => typeof v !== 'string' || v.trim() === '';

function checkboxErrors(file, lines) {
  const errs = [];
  for (const l of lines) {
    if (/^\s*[-*]\[/.test(l.text) || /^\s*[-*] \[(?![ xX]\])[^\]]{0,2}\](?!\()/.test(l.text)) {
      errs.push({ file, line: l.n, message: 'Checkbox sai định dạng: dùng "- [ ]" hoặc "- [x]".' });
    }
  }
  return errs;
}

export function validateChange(dir) {
  const errors = [];
  const add = (file, message, line) => errors.push(line ? { file, line, message } : { file, message });
  const progressPath = join(dir, 'progress.md');
  if (!existsSync(progressPath)) return [{ file: 'progress.md', message: 'Thiếu progress.md.' }];
  const raw = readFileSync(progressPath, 'utf8');
  const { data } = parseFrontmatter(raw);
  const lines = unfenced(raw);

  if (!/^---\r?\n/.test(raw)) add('progress.md', 'Thiếu frontmatter (khối --- ở đầu file).');
  for (const f of ['change', 'title', 'owner', 'next']) {
    if (blank(data[f])) add('progress.md', `Trường ${f} thiếu hoặc rỗng trong frontmatter.`);
  }
  if (!blank(data.change) && data.change !== basename(dir)) {
    add('progress.md', `Trường change "${data.change}" phải trùng tên thư mục "${basename(dir)}".`);
  }
  const stage = data.stage;
  if (!STAGES.includes(stage)) add('progress.md', `Trường stage "${stage ?? ''}" không hợp lệ; chọn một trong: ${STAGES.join(', ')}.`);
  if (typeof data.test_lock !== 'boolean') add('progress.md', 'Trường test_lock phải là true hoặc false.');
  if ('blocked_by' in data && typeof data.blocked_by !== 'string') add('progress.md', 'Trường blocked_by phải là chuỗi (có thể để trống).');
  if ('links' in data && !isMap(data.links) && data.links !== '') add('progress.md', 'Trường links phải là map, ví dụ links: {}.');
  const approvals = data.approvals;
  if ('approvals' in data && !isMap(approvals) && approvals !== '') {
    add('progress.md', 'Trường approvals phải là map các mục `<tên>: { by: <người>, at: <YYYY-MM-DD> }`.');
  } else if (isMap(approvals)) {
    for (const [k, v] of Object.entries(approvals)) {
      if (!isMap(v)) add('progress.md', `Trường approvals.${k} phải có dạng { by: <người>, at: <YYYY-MM-DD> }.`);
      else {
        if (blank(v.by)) add('progress.md', `Trường approvals.${k} thiếu by.`);
        if (blank(v.at)) add('progress.md', `Trường approvals.${k} thiếu at.`);
      }
    }
  }

  // ## Log and its entries
  const logAt = lines.findIndex((l) => /^## Log\s*$/.test(l.text));
  if (logAt < 0) add('progress.md', 'Thiếu mục "## Log".');
  else {
    for (const l of lines.slice(logAt + 1)) {
      if (/^## /.test(l.text)) break;
      if (/^### /.test(l.text) && !LOG_HEADING.test(l.text.trimEnd())) {
        add('progress.md', 'Log: tiêu đề mục phải có dạng "### <YYYY-MM-DD> — <người> + <agent>".', l.n);
      }
    }
  }

  // Files required by stage
  const idx = STAGES.indexOf(stage);
  const live = idx >= 0 && stage !== 'dropped';
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
  const texts = Object.fromEntries(Object.keys(REQUIRED_HEADINGS).map((f) => [f, read(f)]));
  if (live && idx > STAGES.indexOf('intent') && texts['intent.md'] === null) add('intent.md', 'Thiếu intent.md.');
  if (live && idx >= STAGES.indexOf('plan')) {
    if (texts['spec.md'] === null && !hasHeading(lines, '## Design')) {
      add('spec.md', 'Thiếu spec.md (hoặc mục "## Design" trong progress.md với change nhỏ).');
    }
    if (!isMap(approvals) || !approvals.spec) add('progress.md', 'Thiếu approvals.spec ở stage plan trở đi.');
  }
  if (live && idx >= STAGES.indexOf('build') && texts['plan.md'] === null && !hasHeading(lines, '## Plan')) {
    add('plan.md', 'Thiếu plan.md (hoặc mục "## Plan" trong progress.md với change nhỏ).');
  }
  if (live && stage === 'review' && texts['review.md'] === null && !hasHeading(lines, '## Review')) {
    add('review.md', 'Thiếu review.md ở stage review.');
  }

  // Required headings and checkboxes
  for (const [file, headings] of Object.entries(REQUIRED_HEADINGS)) {
    const text = texts[file];
    if (text === null) continue;
    const fl = unfenced(text);
    for (const h of headings) if (!hasHeading(fl, h)) add(file, `Thiếu mục "${h}".`);
    if (file === 'plan.md') errors.push(...checkboxErrors(file, fl));
  }
  const s = lines.findIndex((l) => /^## Plan\s*$/.test(l.text));
  if (s >= 0) {
    const e = lines.findIndex((l, i) => i > s && /^## /.test(l.text));
    errors.push(...checkboxErrors('progress.md', lines.slice(s + 1, e < 0 ? undefined : e)));
  }
  return errors;
}

// Slugs of changes touched in this session (baseline + git), see touchedFiles.
export function touchedChanges(root, sessionId) {
  const slugs = new Set();
  for (const f of touchedFiles(root, sessionId).touched) {
    const m = /^sdlc\/changes\/([^/]+)\//.exec(f);
    if (m) slugs.add(m[1]);
  }
  return [...slugs].sort();
}
