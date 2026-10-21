import claudeCode from './claude-code.mjs';
import codex from './codex.mjs';
import agy from './agy.mjs';

const ADAPTERS = { 'claude-code': claudeCode, codex, agy };

export const ADAPTER_NAMES = Object.keys(ADAPTERS);

export function getAdapter(name) {
  return Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : null;
}
