// Parses the YAML subset used in sdlc artifact frontmatter: scalars,
// one level of indented maps, and inline flow maps `{ k: v }`.
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: parseBlock(m[1]), body: text.slice(m[0].length) };
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('{') && v.endsWith('}')) return parseFlowMap(v);
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
  return v;
}

function parseFlowMap(v) {
  const out = {};
  const inner = v.slice(1, -1).trim();
  if (!inner) return out;
  for (const part of inner.split(',')) {
    const i = part.indexOf(':');
    if (i !== -1) out[part.slice(0, i).trim()] = parseScalar(part.slice(i + 1));
  }
  return out;
}

function parseBlock(src) {
  const data = {};
  const blockKeys = new Set();
  let parent = null;
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const rest = line.slice(i + 1);
    if (/^\s/.test(line) && parent) {
      data[parent][key] = parseScalar(rest);
    } else if (rest.trim() === '') {
      data[key] = {};
      blockKeys.add(key);
      parent = key;
    } else {
      data[key] = parseScalar(rest);
      parent = null;
    }
  }
  // `key:` with no indented children is an empty scalar, not an empty map.
  for (const key of blockKeys) {
    if (Object.keys(data[key]).length === 0) data[key] = '';
  }
  return data;
}
