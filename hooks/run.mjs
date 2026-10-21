import { fileURLToPath } from 'node:url';
import { getAdapter } from '../adapters/index.mjs';
import { sessionStart } from './handlers/session-start.mjs';
import { preEdit } from './handlers/pre-edit.mjs';
import { preBash } from './handlers/pre-bash.mjs';
import { stop } from './handlers/stop.mjs';

const HANDLERS = { 'session-start': sessionStart, 'pre-edit': preEdit, 'pre-bash': preBash, stop };

export async function runAgentHook(agentName, eventName, rawText, resolveAdapter = getAdapter) {
  const adapter = resolveAdapter(agentName);
  if (!adapter) {
    return { stdout: '', stderr: `[ai-native-sdlc] agent không hỗ trợ: ${agentName}\n`, code: 0 };
  }
  let result = { type: 'allow' };
  let stderr = '';
  try {
    const handler = HANDLERS[eventName];
    if (!handler) throw new Error(`event không hỗ trợ: ${eventName}`);
    const raw = rawText && rawText.trim() ? JSON.parse(rawText) : {};
    const ev = adapter.parse(eventName, raw);
    if (ev) result = (await handler(ev, adapter)) ?? { type: 'allow' };
  } catch (e) {
    stderr = `[ai-native-sdlc] hook lỗi, bỏ qua: ${e?.message ?? String(e)}\n`;
    result = { type: 'allow' };
  }
  let out;
  try {
    out = adapter.render(result);
  } catch (e) {
    stderr += `[ai-native-sdlc] hook lỗi, bỏ qua: ${e?.message ?? String(e)}\n`;
    out = { code: 0 };
    try {
      out = adapter.allowOutput?.() ?? out;
    } catch {
      // The static fallback must never throw; keep the empty allow.
    }
  }
  return { stdout: out.stdout ?? '', stderr: stderr + (out.stderr ?? ''), code: out.code ?? 0 };
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const r = await runAgentHook(arg('agent') ?? '', arg('event') ?? '', raw);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
