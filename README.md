# ai-native-sdlc

Harness hiện thực "The AI-Native SDLC Playbook" (Anthropic) cho nhiều coding agent: Claude Code, Codex CLI và Google Antigravity (`agy`). Mọi thay đổi đi qua một vòng: intent → spec → plan → build → review → lessons. Mỗi bước kết thúc bằng một artifact được commit, bước sau đọc nó. Plugin thêm skill cho từng bước, bảng trạng thái các change đang mở, hooks guardrail và kiểm tra định dạng artifact. Một change bắt đầu ở agent này làm tiếp được ở agent khác.

## Cài đặt

Yêu cầu: Node ≥ 20, git và một agent được hỗ trợ: Claude Code, Codex CLI ≥ 0.163, agy ≥ 1.4.3. Plugin không có dependency. Cùng một repo nguồn chứa manifest cho mọi agent; mỗi agent cài qua cơ chế plugin của chính nó.

### Claude Code

Marketplace `.claude-plugin/marketplace.json`, tên marketplace là `ai-native-sdlc`:

```bash
claude plugin marketplace add haringuyendev/ai-native-sdlc   # hoặc đường dẫn tới bản clone local
claude plugin install ai-native-sdlc@ai-native-sdlc
```

Cập nhật khi repo plugin có thay đổi:

```bash
claude plugin marketplace update ai-native-sdlc
claude plugin update ai-native-sdlc@ai-native-sdlc
```

Cần mở session mới để Claude Code nạp lại skill và hooks.

### Codex CLI

Marketplace `.agents/plugins/marketplace.json`, tên marketplace là `ai-native-sdlc`:

```bash
codex plugin marketplace add haringuyendev/ai-native-sdlc    # hoặc đường dẫn tới bản clone local
codex plugin add ai-native-sdlc@ai-native-sdlc
```

**Duyệt hook một lần.** Codex không chạy hook của plugin cho tới khi bạn duyệt: mở `codex`, gõ `/hooks` và tin cậy các hook của `ai-native-sdlc`. Khi định nghĩa hook đổi (sau một lần cập nhật plugin), Codex bắt duyệt lại. Hook chưa được duyệt thì không chạy, nên harness không thể tự báo: không thấy `<sdlc-status>` ở đầu phiên nghĩa là hook chưa được duyệt.

Cập nhật: chạy lại `codex plugin add ai-native-sdlc@ai-native-sdlc` (marketplace từ git thì chạy `codex plugin marketplace upgrade` trước), mở phiên mới và kiểm tra `/hooks`. Cách cập nhật này chưa được thử với một lần tăng version thật.

### Antigravity (`agy`)

agy 1.4.3 không có marketplace riêng cho team: chỉ cài được từ thư mục local hoặc từ GitHub. Repo nguồn chứa sẵn `plugin.json` và `hooks.json` ở gốc cho agy.

```bash
agy plugin install <đường-dẫn-tới-repo-này>
agy plugin install https://github.com/haringuyendev/ai-native-sdlc
agy plugin list                                         # kiểm tra: ai-native-sdlc (enabled, <version>)
```

Cập nhật: `agy plugin uninstall ai-native-sdlc` rồi cài lại như trên, sau đó mở phiên mới. Cách cập nhật này chưa được thử với một lần tăng version thật.

Giới hạn đã biết:

- **Gate hỏi nhưng không hiện lý do.** Hook trả `ask` thì agy hiện hộp xác nhận lệnh, nhưng không hiện lý do của gate. Lý do đầy đủ nằm trong `reason` của gate tương ứng trong `sdlc/config.json`.
- **`--dangerously-skip-permissions` tự duyệt cả gate.** Ở chế độ này agy chấp nhận luôn quyết định `ask`, nên gate không còn tác dụng (`protected_paths`, secret, `test_lock` vẫn chặn). Không dùng cờ này trong repo thật.
- **Hook dựa vào thư mục hiện tại.** agy 1.4.3 không thay biến đường dẫn plugin trong lệnh hook, nên `hooks.json` gọi `node hooks/run.mjs` theo đường dẫn tương đối và dựa vào việc agy chạy hook với thư mục hiện tại là gốc plugin. Nếu agy đổi hành vi này thì hook không chạy.

### Khác biệt giữa các agent

| | Claude Code | Codex | agy |
|---|---|---|---|
| Gọi skill | Skill tool `ai-native-sdlc:<tên>` hoặc `/ai-native-sdlc:<tên>` | `$<tên>` hoặc nêu tên skill | `/<tên>` |
| Gate (`gates`) | Hỏi người dùng kèm lý do | Hỏi qua `.codex/rules/ai-native-sdlc.rules`; gate thiếu `prefixes` thì bị **chặn** | Hỏi, nhưng không hiện lý do |
| Cài đặt | Marketplace (`claude plugin`) | Marketplace (`codex plugin`) | Thư mục local hoặc URL GitHub (`agy plugin install`) |
| Duyệt hook | Không cần | Một lần trong `/hooks`, duyệt lại khi hook đổi | Không cần |
| File chỉ dẫn | `CLAUDE.md` (= `@AGENTS.md`) | `AGENTS.md` | `AGENTS.md` |
| Verifier subagent | `.claude/agents/verifier.md` | `.codex/agents/verifier.toml` | `.agents/agents/verifier.md` |
| Commit của agent | Được | Sandbox `workspace-write` để `.git` chỉ đọc: commit `sdlc(<slug>): … accepted` do người dùng tự làm (hoặc duyệt quyền ghi) | Được |
| Tiêu đề Log | `+ Claude` | `+ Codex` | `+ Antigravity` |

**Gate trên Codex.** Hook của Codex không hỏi được người dùng, nên gate đi qua rules của Codex (`decision = "prompt"`). Rules chỉ khớp theo tiền tố lệnh, vì vậy mỗi gate cần thêm `prefixes` (xem `## Cấu hình`). Lệnh khớp `pattern` mà không khớp tiền tố nào thì hook chặn và đề nghị người dùng tự chạy. File rules do `sync-agent-files` sinh; khi `gates` đổi, bảng trạng thái nhắc chạy lại. Codex chỉ đọc rules của project đã được trust: ở repo chưa trust, hook chặn mọi lệnh khớp gate và nhắc trust repo (hook đọc `trust_level` trong `$CODEX_HOME/config.toml`, mặc định `~/.codex`).

### Nâng cấp từ 1.0.x

Cập nhật plugin không tự đổi file nào trong repo dự án; bố cục cũ (`CLAUDE.md` có nội dung, gate không có `prefixes`) vẫn chạy trên Claude Code như trước. Khi repo thiếu file cho agent khác (`AGENTS.md`, `.codex/rules/…`, verifier), bảng trạng thái nhắc một dòng. Để repo dùng được ở mọi agent, chạy từ gốc repo dự án:

```bash
node <thư-mục-plugin>/scripts/sync-agent-files.mjs --dry-run   # xem diff
node <thư-mục-plugin>/scripts/sync-agent-files.mjs             # hỏi rồi mới ghi (--yes để bỏ qua câu hỏi)
```

`--yes` ghi đè cả `.codex/rules/ai-native-sdlc.rules` nếu bạn đã sửa tay: file này do script sinh, hãy tùy chỉnh qua `gates[].prefixes` trong `sdlc/config.json`.

Script chuyển nội dung `CLAUDE.md` sang `AGENTS.md` (`CLAUDE.md` chỉ còn `@AGENTS.md`), sinh `.codex/rules/ai-native-sdlc.rules` từ các gate có `prefixes` và verifier cho từng agent; verifier đã có không bị ghi đè. Trước đó, thêm `prefixes` cho các gate trong `sdlc/config.json`. Skill `claude-md` được đổi tên thành `agents-md`; tên cũ vẫn là alias. Kiểm tra định dạng mới (`format_check`) chỉ chạy trên change bị chạm trong phiên và bỏ qua change `done`/`dropped`.

**Tắt các plugin workflow khác trong repo dùng harness.** Nếu bật thêm một plugin workflow có skill cùng vai trò (ví dụ superpowers), hai bộ bootstrap cạnh tranh nhau và nhiều mô tả skill trùng nhau, nên Claude có thể chọn nhầm. Tắt plugin superpowers (và các plugin workflow khác) trong repo này, ví dụ bằng `claude plugin disable superpowers` (xem `claude plugin disable --help` để chọn scope).

## Bắt đầu

1. Trong repo dự án, gọi skill `init` (Claude Code: `/ai-native-sdlc:init`; Codex: `$init`; agy: `/init`). agy 1.4.3 không có lệnh `/init` dựng sẵn nên `/init` gọi đúng skill của harness; ngược lại `/plan` của agy là lệnh dựng sẵn, nên với skill `plan` hãy nói rõ "dùng skill plan của ai-native-sdlc". Skill tạo `sdlc/config.json` (guardrail), `sdlc/changes/`, `sdlc/lessons/`, `sdlc/evals/`, `AGENTS.md` (`CLAUDE.md` = `@AGENTS.md`), rules của Codex, verifier cho từng agent và các file mẫu từ `templates/`. Repo chưa init chỉ nhận một dòng gợi ý chạy lệnh này.
2. Mở session mới. Hook SessionStart nạp skill `start` (luật của vòng làm việc) và bảng trạng thái vào ngữ cảnh.
3. Nói với agent việc bạn muốn làm; skill `start` định tuyến tới skill phù hợp (thường là `ai-native-sdlc:intent`).

**Bảng trạng thái** liệt kê các change chưa `done`/`dropped`: slug, stage, owner, số task đã xong, `next`, `blocked_by`, ngày cập nhật cuối. Xem bất cứ lúc nào bằng skill `ai-native-sdlc:status` (trên mọi agent) hoặc:

```bash
node scripts/sdlc-status.mjs [repoRoot]
```

Làm tiếp một change đang mở: `/ai-native-sdlc:resume <change>`. Mọi trạng thái suy ra từ `progress.md` (frontmatter) và checkbox trong `plan.md`; không có file trạng thái riêng.

## Vòng làm việc

```
intent.md → spec.md → plan.md → code + tests → review.md → done
    ↑                                                       │
    └──────── sdlc/lessons/ (incident, bug, lỗi lặp lại) ───┘
```

Mỗi change nằm trong `sdlc/changes/<YYYY-MM-DD>-<slug>/` gồm `intent.md`, `spec.md`, `plan.md`, `review.md`, `progress.md`. Artifact viết bằng tiếng Việt dưới các heading tiếng Anh cố định của template.

`progress.md` có `stage` (`intent | spec | plan | build | review | done | dropped`). Chỉ chuyển stage sau khi người dùng duyệt artifact, ghi `approvals.<stage>` và commit `sdlc(<slug>): <stage> accepted`. Mỗi session ghi một mục vào `## Log` (đã làm, commit, còn dở, rủi ro) với tiêu đề `### <YYYY-MM-DD> — <người> + <agent>` (ví dụ `+ Claude`, `+ Codex`), nên khi đổi agent vẫn biết ai làm bước nào.

**Mức nghi thức theo cỡ việc:**

| Mức | Khi nào | Artifact |
|---|---|---|
| architectural | Thay đổi lớn, nhiều thành phần | Cả chuỗi intent → spec → plan → review |
| bounded | Việc vừa, phạm vi rõ | `intent.md` ngắn; thiết kế và plan nằm trong `progress.md` |
| spike | Việc nhỏ và rõ | Không tạo folder, cứ làm |

## Skill

Trên Claude Code gọi bằng `ai-native-sdlc:<tên>`; Codex dùng `$<tên>`, agy dùng `/<tên>` (xem bảng khác biệt ở `## Cài đặt`). Agent tự chọn skill theo mô tả, bạn cũng có thể gọi trực tiếp. Mọi agent đọc cùng một bản `skills/<tên>/SKILL.md`.

| Skill | Dùng khi |
|---|---|
| `ai-native-sdlc:start` | Đầu mọi session; nạp tự động, định tuyến tới skill khác |
| `ai-native-sdlc:init` | Repo chưa có `sdlc/config.json` |
| `ai-native-sdlc:intent` | Ý tưởng, ticket, yêu cầu hoặc sự cố mới chưa có change folder |
| `ai-native-sdlc:spec` | Intent đã duyệt, cần yêu cầu và thiết kế (viết `spec.md`) |
| `ai-native-sdlc:plan` | Spec đã duyệt, cần kế hoạch nhiều bước (viết `plan.md`) |
| `ai-native-sdlc:worktree` | Cần workspace cách ly trước khi triển khai |
| `ai-native-sdlc:build` | Thực thi plan bằng subagent, mỗi task một subagent |
| `ai-native-sdlc:run` | Thực thi plan ngay trong session, không dùng subagent |
| `ai-native-sdlc:tdd` | Trước khi viết code cho tính năng hoặc bugfix |
| `ai-native-sdlc:debug` | Gặp bug, test fail hoặc hành vi lạ, trước khi đề xuất sửa |
| `ai-native-sdlc:verify` | Sắp tuyên bố xong, commit, tick checkbox hoặc đổi stage; phải chạy lệnh kiểm chứng |
| `ai-native-sdlc:review` | Làm xong, cần review nhánh theo `REVIEW.md`, spec, plan (viết `review.md`) |
| `ai-native-sdlc:fix-review` | Xử lý finding trong `review.md` hoặc comment PR |
| `ai-native-sdlc:finish` | Review xong, quyết định cách tích hợp nhánh (merge, PR, bỏ) |
| `ai-native-sdlc:parallel` | Từ 2 việc độc lập trở lên, không chia sẻ trạng thái |
| `ai-native-sdlc:resume` | Làm tiếp change đang mở hoặc nhận lại việc của người khác |
| `ai-native-sdlc:policy` | Biến chính sách tổ chức (bảo mật, API, UX) thành skill |
| `ai-native-sdlc:agents-md` | Agent lặp lại một lỗi lần thứ hai, hoặc cần cập nhật hay dọn `AGENTS.md` (`claude-md` là alias) |
| `ai-native-sdlc:lesson` | Sự cố, bug lọt hoặc post-mortem cần ghi lại và chốt bằng regression guard |
| `ai-native-sdlc:eval` | Tạo, chạy hoặc dọn eval bảo vệ hành vi của agent |
| `ai-native-sdlc:status` | Xem bảng các change đang mở, bị chặn hoặc lâu không cập nhật (Claude Code: `/ai-native-sdlc:status`, Codex: `$status`, agy: `/status`) |

## Guardrail

Hooks đọc `sdlc/config.json` của repo dự án; repo không có file này thì hooks cho qua. Mọi agent gọi chung `hooks/run.mjs --agent <claude-code|codex|agy> --event <...>`; adapter trong `adapters/` dịch giao thức riêng của từng agent. Đăng ký: Claude Code `hooks/hooks.json`, Codex `hooks/codex-hooks.json`, agy `hooks.json` ở gốc.

| Guard | Sự kiện | Hành vi |
|---|---|---|
| `protected_paths` | Edit/Write | Chặn sửa file khớp glob, nêu lý do và cách xin duyệt |
| `test_lock` | Edit/Write | Khi change đang mở có `test_lock: true` trong `progress.md`, chặn sửa file khớp `test_globs` (để Claude không sửa test cho khớp code) |
| secret | Edit/Write | Chặn nội dung có vẻ là khóa riêng, token (AKIA, ghp_, xox, sk-...) hoặc gán cứng `password=`/`api_key=`. Dữ liệu giả: thêm đường dẫn vào `secret_allow` |
| `gates` | Bash | Lệnh khớp regex thì hỏi lại người dùng (`ask`) kèm lý do. Codex: hỏi qua rules (cần `prefixes`), không có tiền tố khớp thì chặn |
| Stop hook (`handoff_log`) | Stop | Nếu change ở `build`/`review` có file ngoài `sdlc/` bị sửa mà `progress.md` chưa được ghi, giữ agent lại để ghi `## Log`; một lần cho mỗi tập thay đổi |
| Stop hook (`format_check`) | Stop | Kiểm định dạng artifact của các change bị chạm trong phiên (frontmatter, heading bắt buộc, tiêu đề Log, stage khớp artifact); sai thì giữ agent lại để tự sửa. Vẫn sai sau một lần thì cho dừng và in lỗi ra stderr |

**Đây là guardrail, không phải cơ chế cưỡng chế.** Các guard chỉ áp cho tool sửa file (Claude Code: `Edit`, `Write`, `MultiEdit`, `NotebookEdit`; Codex: `apply_patch`; agy: `write_file`, `edit_file` và các biến thể). Ghi file qua Bash (`sed -i`, `cat > file`) không bị chặn; hook Bash chỉ kiểm `gates`. Muốn ràng buộc thật thì dùng thêm branch protection, CODEOWNERS và CI.

Kiểm định dạng bằng tay hoặc trong CI: `node scripts/sdlc-check.mjs [change]` (in `OK` hoặc danh sách lỗi, exit 1 khi có lỗi).

Hook không bao giờ làm hỏng session: lỗi chỉ in ra stderr và cho qua, ở mọi agent. Khi hook chặn, agent phải giải thích lý do cho bạn và đi theo hướng hook chỉ, không lách. Hook chỉ đọc repo; mốc session lưu ngoài repo (`$AI_SDLC_STATE_DIR` hoặc thư mục tạm của hệ điều hành).

## Cấu hình

`sdlc/config.json` (mẫu: `templates/config.json`). Thiếu key thì dùng mặc định; JSON lỗi thì hook in cảnh báo và tạm tắt guardrail.

| Key | Ý nghĩa | Mặc định |
|---|---|---|
| `verify` | Lệnh `build`, `test`, `lint` mà skill `verify` chạy | `{}` |
| `protected_paths` | Mảng glob cấm sửa (ví dụ `["infra/**", ".github/workflows/**"]`) | `[]` |
| `test_globs` | Glob nhận diện file test cho `test_lock` | `**/*.test.*`, `**/*.spec.*`, `**/test_*.py`, `**/tests/**` |
| `gates` | Mảng `{ "pattern": "<regex>", "reason": "...", "prefixes": [["git", "push", "--force"]] }` cho lệnh Bash cần xác nhận. `pattern` dùng cho Claude Code và agy; `prefixes` (tuỳ chọn, mảng tiền tố lệnh) sinh rules cho Codex | `[]` (mẫu của `init` cũng `[]`) |
| `secret_allow` | Glob được miễn kiểm secret | `[]` |
| `secret_scan` | `false` để tắt quét secret khi ghi file | `true` (mẫu của `init` đặt `false`) |
| `handoff_log` | `false` để tắt nhắc ghi Log của Stop hook | `true` |
| `format_check` | `false` để tắt kiểm định dạng artifact khi dừng | `true` |

Glob hỗ trợ `**`, `*`, `?`.

### Bật/tắt guardrail

Repo mới `init` không bị plugin chặn: không gate, không quét secret, `protected_paths` trống. Vẫn bật: nhắc ghi Log và kiểm định dạng artifact khi dừng (`handoff_log`, `format_check`), `test_lock` khi một change tự đặt `true`. Hook đọc lại config mỗi lần chạy, sửa xong là có hiệu lực.

**Bật lại** trong `sdlc/config.json`: quét secret bằng `"secret_scan": true`; gate bằng cách chép hai gate mẫu dưới đây (giữ `prefixes` để Codex có rule), rồi chạy `node <plugin root>/scripts/sync-agent-files.mjs` để sinh `.codex/rules/ai-native-sdlc.rules`:

```json
"gates": [
  { "pattern": "\\bgit\\b.*\\bpush\\b.*(\\s-f\\b|\\s--force\\b|\\s\\+\\S)", "reason": "Force push cần người dùng xác nhận.", "prefixes": [["git", "push", "--force"], ["git", "push", "-f"], ["git", "push", "--force-with-lease"]] },
  { "pattern": "\\b(deploy|release)\\b.*\\b(prod|production)\\b", "reason": "Deploy production cần release manager duyệt." }
]
```

**Tắt ở repo đã `init` từ trước** (bản cũ có gate và luôn quét secret): đặt `"gates": []` và `"secret_scan": false`; với Codex, xoá thêm `.codex/rules/ai-native-sdlc.rules` vì Codex đọc file này chứ không đọc config.

**Agent vẫn hỏi trước lệnh như `rm`?** Đó là lớp quyền của chính agent, không phải plugin. Ví dụ với Claude Code, thêm vào `.claude/settings.json` của repo: `{ "permissions": { "allow": ["Bash(rm:*)"] } }`.

## Eval và lesson

**Lesson** (`sdlc/lessons/<YYYY-MM-DD>-<slug>.md`, không đổ lỗi cho cá nhân): sự cố, nguyên nhân gốc, cách sửa và regression guard. Guard là test (qua `ai-native-sdlc:tdd`) hoặc eval (qua `ai-native-sdlc:eval`). Lỗi lặp lại của agent thì chuyển thành một dòng trong `AGENTS.md` (`ai-native-sdlc:agents-md`; `ai-native-sdlc:claude-md` là alias).

**Eval** (`sdlc/evals/<name>.json`, mẫu `templates/eval.json`) là kiểm tra hồi quy cho hành vi của agent. Runner chạy agent không tương tác (`claude -p`; `codex exec` với `--agent codex`; `agy -p` với `--agent agy`) trong một git worktree tạm tại HEAD, chấm kết quả rồi xoá worktree:

```json
{
  "name": "task-format-vnd",
  "description": "Vì sao check fail nếu hành vi hỏng",
  "source": "task",
  "prompt": "Viết hàm formatVnd(amount) trong lib/money.mjs",
  "max_turns": 10,
  "allowed_tools": "Read,Write,Edit,Bash(npm test),Skill(ai-native-sdlc:tdd)",
  "checks": [
    { "type": "skill_first", "skill": "ai-native-sdlc:tdd" },
    { "type": "command", "run": "npm test" }
  ]
}
```

- `source`: `task | incident | trigger`. `incident` bắt buộc có `lesson` trỏ tới file lesson.
- Tuỳ chọn: `timeout_sec` (mặc định 600), `max_turns` (mặc định 10), `allowed_tools`, `args`.
- Loại check: `skill_first` (skill được gọi đầu tiên), `skill_never`, `output_includes`, `output_excludes`, `command` (chạy trong worktree, `expect_exit` mặc định 0). Không có LLM-judge trong v1.
- `allowed_tools` vừa giới hạn vừa duyệt sẵn: chỉ các tool được liệt kê có mặt (`--tools`, bỏ phần `(...)`), các rule được duyệt không cần hỏi (`--allowedTools`), mọi lệnh gọi tool khác bị từ chối (runner luôn truyền `--permission-mode dontAsk`). Task tạo file cần `Write`; check skill cần `Skill`.
- `command` và `args` chạy như code bình thường với môi trường và quyền của bạn (ví dụ `args: ["--dangerously-skip-permissions"]` bỏ hết giới hạn). Review file eval như review code test, nhất là trong PR.

```bash
node scripts/run-evals.mjs --dry-run              # chỉ kiểm định dạng
node scripts/run-evals.mjs --agent codex          # chạy trên Codex (mặc định claude-code)
node scripts/run-evals.mjs --agent agy            # chạy trên agy
node scripts/run-evals.mjs --only trigger-        # eval có tên bắt đầu bằng tiền tố
node scripts/run-evals.mjs --min-pass 0.85        # ngưỡng đạt, mặc định 1
node scripts/run-evals.mjs --json                 # kết quả dạng JSON
node scripts/run-evals.mjs --plugin-dir-from-head .   # nạp plugin từ HEAD (thư mục con tính từ gốc repo)
node scripts/run-evals.mjs --root ../repo-khac     # chạy eval của checkout khác, không cần cd
```

Exit code: `0` đạt ngưỡng, `1` dưới ngưỡng, `2` lỗi (eval sai định dạng, không có eval nào, `--only` không khớp), `130` khi bị dừng bằng Ctrl-C (worktree tạm vẫn được xoá; worktree sót lại từ lần chạy bị kill được dọn ở lần chạy sau). Eval chạy trên HEAD nên phải commit trước; thay đổi chưa commit bị cảnh báo và không được đánh giá. HEAD chỉ áp dụng cho file của chính repo (`CLAUDE.md`, `.claude/**`, code); plugin, kể cả plugin này, được nạp từ bản đã cài. Muốn đánh giá thay đổi của chính một plugin thì chạy trong repo plugin với `--plugin-dir-from-head <thư mục con>` (`.` nếu plugin ở gốc repo) và tắt bản đã cài trong lần chạy đó (`claude plugin disable ai-native-sdlc@ai-native-sdlc`, chạy xong thì `claude plugin enable ai-native-sdlc@ai-native-sdlc`). Mỗi lần chạy gọi API thật nên tốn chi phí. Đặt `AI_SDLC_CLAUDE_BIN` để thay binary `claude` (dùng khi test). Kiểm tra thủ công việc chọn skill: `tests/skill-triggers/README.md`.

Trên Codex (`--agent codex`): eval dùng plugin đã cài (`codex plugin add`), sandbox `workspace-write` và `--dangerously-bypass-hook-trust`; model mặc định `gpt-6-luna`, đổi bằng `AI_SDLC_CODEX_MODEL`, binary bằng `AI_SDLC_CODEX_BIN`. `allowed_tools`, `args` và `max_turns` chỉ áp cho Claude Code. Codex không báo skill trong output nên runner nhận diện skill qua việc agent đọc `skills/<tên>/SKILL.md`.

Skill và tool cá nhân có thể tranh với skill của harness trên Codex: skill trong `~/.codex/skills` và `~/.agents/skills` (ví dụ `brainstorming`), và MCP server toàn cục (ví dụ context-mode) đọc SKILL.md hộ agent nên runner không thấy lượt đọc đó. Muốn kết quả sạch, chạy với `CODEX_HOME` riêng chứa bản sao `auth.json`, `config.toml` tối thiểu (không MCP server) và plugin này (`CODEX_HOME=<dir> codex plugin marketplace add …`, `codex plugin add …`). `~/.agents/skills` vẫn được đọc khi đổi `CODEX_HOME`, nên tắt từng skill trong `config.toml` riêng đó:

```toml
[[skills.config]]
path = "/Users/<bạn>/.agents/skills/brainstorming/SKILL.md"
enabled = false
```

Trên agy (`--agent agy`): eval dùng plugin đã cài và chạy `agy -p` với `--dangerously-skip-permissions`, vì chế độ headless tự từ chối mọi lệnh shell. Việc này chỉ diễn ra trong worktree tạm; hook vẫn chặn như thường, riêng gate được tự duyệt. Skill được nhận diện qua việc agent đọc `skills/<tên>/SKILL.md`. Model lấy từ `AI_SDLC_AGY_MODEL` (không đặt thì dùng model mặc định của tài khoản, có thể trả lỗi 503 hết capacity), binary từ `AI_SDLC_AGY_BIN`.

**Timeout trên Codex và agy.** `codex exec` và `agy -p` không giới hạn số lượt, nên agent thường làm tiếp việc thật (chạy test, sửa code) tới khi chạm `timeout_sec`. Khi đó runner chấm phần output đã nhận: `skill_first`/`skill_never` được chấm như bình thường, check cần lần chạy kết thúc (`output_*`, `command`) thì fail; chưa gọi skill nào thì fail với lý do "quá thời gian".

**Kết quả đo được với bản 1.2.0** (21 eval trigger của repo này): Claude Code 21/21 ở lần chạy thứ hai (lần 1: 20/21, `trigger-build` không gọi skill nào). agy 21/21 với model mặc định của tài khoản. Codex 11/21 với `CODEX_HOME` riêng: 4 eval chọn sai skill (`trigger-build`, `trigger-claude-md`, `trigger-intent`, `trigger-parallel`), `trigger-run` đã chạy nhưng báo `build`/`tdd` rồi exit 1, và 5 eval cuối exit 1 không có output (probe chạy sau xác nhận hết quota); cần chạy lại khi có quota.

**Ví dụ CI** (chỉ là ví dụ lấy từ ý tưởng của playbook, plugin không kèm CI; CI nằm ngoài phạm vi v1). Trong repo dự án, thay đường dẫn script bằng nơi plugin được cài:

```yaml
# .github/workflows/evals.yml
name: evals
on:
  pull_request:
    paths: ["CLAUDE.md", ".claude/**", "skills/**", "sdlc/evals/**"]
  schedule:
    - cron: "0 2 * * *"   # chạy hằng đêm
jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install -g @anthropic-ai/claude-code
      - run: node scripts/run-evals.mjs --min-pass 0.85   # repo dự án: node <plugin>/scripts/run-evals.mjs
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Phát triển plugin

```bash
npm test                              # toàn bộ test (node --test tests/*.test.mjs)
node --test tests/<name>.test.mjs     # một file
node scripts/sdlc-status.mjs          # bảng trạng thái
echo '{"cwd":"'$PWD'"}' | node hooks/session-start.mjs   # thử hook bằng tay
echo '{"cwd":"'$PWD'"}' | node hooks/run.mjs --agent codex --event session-start   # thử hook của một agent
```

Quy ước: Node ≥ 20, ES module `.mjs`, không dependency. Logic thuần nằm trong `lib/` và có test; `hooks/*.mjs` chỉ đọc stdin, gọi lib rồi trả exit code hoặc JSON. `SKILL.md` viết bằng tiếng Anh; template và thông điệp cho người dùng bằng tiếng Việt. Phát hành bản public: `node scripts/export-public.mjs <bản clone của repo public>` xuất HEAD, bỏ `sdlc/changes/`, `sdlc/lessons/` và mục SDLC harness của `AGENTS.md`; rồi commit và push từ thư mục đó. Thêm agent mới: một adapter trong `adapters/` (`parse`, `render`, `evalCommand`, `parseEvalStream`) và file hook/manifest của agent đó, không sửa `lib/` hay skill. Xem thêm `AGENTS.md`.

## Ghi công

Playbook gốc: "The AI-Native SDLC Playbook", Anthropic (Louis Claxton). Plugin này phát hành theo giấy phép MIT.
