# ai-native-sdlc

Plugin Claude Code hiện thực "The AI-Native SDLC Playbook": vòng intent → spec → plan → build → review → lessons, có bảng trạng thái và hooks guardrail. Hướng dẫn dùng: README.md.

## Commands
- Test: `npm test` (một file: `node --test tests/<name>.test.mjs`)
- Xem bảng trạng thái: `node scripts/sdlc-status.mjs`
- Thử hook bằng tay: `echo '{"cwd":"'$PWD'"}' | node hooks/session-start.mjs`
- Xuất bản public: `node scripts/export-public.mjs <clone public>` (bỏ sdlc/changes, sdlc/lessons)
- Eval: `node scripts/run-evals.mjs --dry-run` (kiểm định dạng), `--only <tên>` (chạy thật, tốn API)

## Conventions
- Node ≥ 20, ES modules `.mjs`, không dependency.
- Logic trong `lib/` (thuần, có test); `hooks/*.mjs` chỉ đọc stdin → gọi lib → exit code/JSON.
- Hook không bao giờ làm hỏng session: lỗi → stderr, exit 0. Hook chỉ đọc, không ghi; ngoài repo chỉ đọc cấu hình của agent khi cần (ví dụ `trust_level` trong `$CODEX_HOME/config.toml`).
- SKILL.md tiếng Anh; template và thông điệp cho người dùng tiếng Việt.

## Architecture
- `hooks/hooks.json` đăng ký SessionStart (bootstrap + bảng trạng thái), PreToolUse (pre-edit, pre-bash), Stop (handoff log).
- `lib/changes.mjs` đọc `sdlc/changes/*/progress.md`; mọi trạng thái suy ra từ frontmatter và checkbox của plan.md.
- `templates/` được skill copy vào repo dự án.

## Verifying your work
- Chạy `npm test` trước khi báo xong và dán output. Test đỏ thì sửa code, không sửa test.

## Things agents get wrong
- (chưa có)
