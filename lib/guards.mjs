import { matchesAny } from './glob.mjs';

const SECRET_PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['API key dạng sk-', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['mật khẩu/secret gán cứng', /\b(?:password|passwd|secret|api_?key)\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];

export function editedText(toolInput = {}) {
  const parts = [toolInput.content, toolInput.new_string, toolInput.new_source];
  for (const e of toolInput.edits ?? []) parts.push(e.new_string);
  return parts.filter((p) => typeof p === 'string').join('\n');
}

export function checkProtected(repoPath, config) {
  if (!matchesAny(repoPath, config.protected_paths)) return null;
  return `[ai-native-sdlc] ${repoPath} nằm trong protected_paths (sdlc/config.json). Không sửa trực tiếp; nếu thật sự cần, hỏi người dùng để owner duyệt rồi tạm gỡ đường dẫn khỏi protected_paths.`;
}

export function checkTestLock(repoPath, config, lockedSlugs) {
  if (lockedSlugs.length === 0 || !matchesAny(repoPath, config.test_globs)) return null;
  return `[ai-native-sdlc] test_lock đang bật cho ${lockedSlugs.join(', ')}: không sửa file test ${repoPath} khi đang fix. Sửa code để test pass; nếu test sai, báo người dùng để họ tắt test_lock trong progress.md.`;
}

const PLACEHOLDER_MARKERS = ['<', '${', 'process.env', 'os.environ', 'EXAMPLE', 'example', 'xxxx'];

export function checkSecrets(text) {
  for (const [label, re] of SECRET_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(global)) {
      if (PLACEHOLDER_MARKERS.some((p) => m[0].includes(p))) continue;
      return `[ai-native-sdlc] Nội dung có vẻ chứa ${label}. Không ghi secret vào repo; dùng biến môi trường hoặc secret manager. Nếu đây là dữ liệu giả (test/docs), thêm đường dẫn vào secret_allow trong sdlc/config.json.`;
    }
  }
  return null;
}

export function checkGates(command, config) {
  const gate = config.gates.find((g) => {
    try {
      return new RegExp(g.pattern).test(command);
    } catch {
      return false;
    }
  });
  return gate ? `[ai-native-sdlc] Lệnh khớp gate "${gate.pattern}": ${gate.reason}` : null;
}
