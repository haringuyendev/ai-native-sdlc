// Parse Codex apply_patch text into per-file entries.

const HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;

export function parseApplyPatch(text) {
  if (typeof text !== 'string' || !text.includes('*** Begin Patch')) return [];
  const files = [];
  let cur = null;
  let added = [];
  const flush = () => {
    if (cur) files.push({ ...cur, added: added.join('\n') });
    cur = null;
    added = [];
  };
  for (const line of text.split('\n')) {
    const h = HEADER.exec(line);
    if (h) {
      flush();
      cur = { path: h[2].trim(), op: h[1].toLowerCase() };
    } else if (line.startsWith('*** End Patch')) {
      flush();
    } else if (cur && line.startsWith('*** Move to: ')) {
      cur.moveTo = line.slice('*** Move to: '.length).trim();
    } else if (cur && line.startsWith('+')) {
      added.push(line.slice(1));
    }
  }
  flush();
  return files;
}
