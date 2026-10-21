# Skill trigger prompts

Manual check that each skill's description makes Claude pick the right skill first. It runs against the skills at HEAD of this repo, so commit first.

## How to run

Disable the superpowers plugin (and any other workflow plugin) for the run — several descriptions overlap. Also disable the installed copy of this plugin, so only the HEAD copy is loaded: `claude plugin disable ai-native-sdlc@ai-native-sdlc` (re-enable it afterwards with `claude plugin enable ai-native-sdlc@ai-native-sdlc`).

Run from the root of this plugin repo (it is itself initialized with the harness):

```bash
node scripts/run-evals.mjs --only trigger- --min-pass 0.85 --plugin-dir-from-head .
```

`--plugin-dir-from-head .` loads the plugin from the eval worktree at HEAD; without it the run grades the installed plugin, not your change.

Each prompt below is an eval in `sdlc/evals/` (see the Eval column). An eval passes when the first skill invoked matches the Expected column (row 14: `intent` must not be invoked). The runner exits non-zero below 85% (17 of 20). If a skill misses, fix its description first. Use `--dry-run` to only validate the eval files.

| # | Prompt | Expected | Eval |
|---|---|---|---|
| 1 | Tôi muốn thêm chức năng xuất hóa đơn PDF cho khách hàng | intent | `trigger-intent.json` |
| 2 | Intent của change xuat-hoa-don đã duyệt, làm spec tiếp | spec | `trigger-spec.json` |
| 3 | Spec đã duyệt rồi, viết plan triển khai | plan | `trigger-plan.json` |
| 4 | Plan đã duyệt, triển khai bằng subagent từng task | build | `trigger-build.json` |
| 5 | Tự làm plan này trong session, không dùng subagent | run | `trigger-run.json` |
| 6 | Viết hàm formatVnd(amount) trong lib/money.mjs | tdd | `trigger-tdd.json` |
| 7 | npm test đang fail ở changes.test.mjs, không rõ vì sao | debug | `trigger-debug.json` |
| 8 | Sửa xong rồi đúng không? commit luôn đi | verify | `trigger-verify.json` |
| 9 | Làm xong hết task trong plan rồi, review giúp | review | `trigger-review.json` |
| 10 | Xử lý các finding trong review.md | fix-review | `trigger-fix-review.json` |
| 11 | Review ổn rồi, merge branch này vào main | finish | `trigger-finish.json` |
| 12 | Tạo môi trường làm việc riêng cho change này trước khi code | worktree | `trigger-worktree.json` |
| 13 | Ba file test fail với ba lỗi khác nhau, không liên quan nhau | parallel | `trigger-parallel.json` |
| 14 | Đổi chữ nút "Gửi" thành "Gửi đơn" (đối chứng âm) | không gọi intent | `trigger-negative-copy-change.json` |
| 15 | Mình muốn làm tiếp cái change hôm qua | resume | `trigger-resume.json` |
| 16 | Biến chuẩn bảo mật API của công ty thành quy tắc Claude luôn áp | policy | `trigger-policy.json` |
| 17 | Claude lại dùng float cho tiền lần thứ hai rồi | claude-md | `trigger-claude-md.json` |
| 18 | Hôm qua deploy làm hỏng thanh toán, viết post-mortem | lesson | `trigger-lesson.json` |
| 19 | Biến task xuất hóa đơn vừa xong thành eval để kiểm tra mỗi lần đổi skill | eval | `trigger-eval.json` |
| 20 | Từ giờ trong repo này luôn dùng pnpm, đừng dùng npm | claude-md | `trigger-claude-md-2.json` |

## Full loop

In a sample repo, take one small change through intent → spec → plan → build (1 task) → review → done. After each step confirm `/ai-native-sdlc:status` shows the right stage and that the `sdlc(<slug>): ...` commits were created.
