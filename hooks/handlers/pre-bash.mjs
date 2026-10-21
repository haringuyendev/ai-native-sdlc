import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../lib/config.mjs';
import { findRoot } from '../../lib/repo.mjs';
import { checkGates } from '../../lib/guards.mjs';
import { rulesInSync } from '../../lib/agent-files.mjs';
import { matchesPrefix, RULES_PATH } from '../../lib/codex-rules.mjs';
import { codexProjectTrusted } from '../../lib/codex-trust.mjs';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function preBash(ev, adapter) {
  const root = findRoot(ev.cwd);
  if (!root) return { type: 'allow' };
  const { config } = loadConfig(root);
  if (!config) return { type: 'allow' };
  const command = ev.command ?? '';
  const matching = config.gates.filter((g) => checkGates(command, { gates: [g] }));
  if (matching.length === 0) return { type: 'allow' };
  if (adapter?.name !== 'codex') return { type: 'ask', reason: checkGates(command, { gates: [matching[0]] }) };

  // Codex cannot ask from a hook: gates covered by a prefix are prompted by its rules file.
  const uncovered = matching.find((g) => !matchesPrefix(command, g.prefixes ?? []));
  if (uncovered) return { type: 'ask', reason: checkGates(command, { gates: [uncovered] }) };
  if (!rulesInSync(root, config)) {
    return {
      type: 'deny',
      reason: `[ai-native-sdlc] File rules của Codex (${RULES_PATH}) chưa có hoặc đã cũ nên lệnh này không được hỏi xác nhận. Chạy: node "${join(PLUGIN_ROOT, 'scripts', 'sync-agent-files.mjs')}" rồi thử lại.`,
    };
  }
  if (!codexProjectTrusted(root)) {
    return {
      type: 'deny',
      reason: `[ai-native-sdlc] Codex chưa trust repo ${root} nên bỏ qua ${RULES_PATH}: lệnh này sẽ chạy mà không hỏi xác nhận. Hãy trust repo trong Codex (mở codex ở thư mục này và chọn trust) rồi thử lại, hoặc để người dùng tự chạy lệnh.`,
    };
  }
  return { type: 'allow' };
}
