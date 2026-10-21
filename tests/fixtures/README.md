# Hook payload fixtures

Each file is the exact stdin JSON an agent sends to a hook. Machine paths are replaced by `/repo` (workspace) and `/home/user` (home). Claude Code fixtures are constructed from the documented payload shape (not recorded).

## How to re-record

Install a probe plugin whose hooks run a node script that appends raw stdin to a log file, run one session, then sanitize.

- Codex 0.163: marketplace `<dir>/.agents/plugins/marketplace.json` + plugin `.codex-plugin/plugin.json` + `hooks/hooks.json` (Claude Code format).
  `codex plugin marketplace add <dir>`; `codex plugin add <plugin>@<marketplace>`;
  `codex exec -m gpt-6-luna --dangerously-bypass-hook-trust -s workspace-write --skip-git-repo-check '<prompt>' </dev/null`.
  Cleanup: `codex plugin remove`, remove the marketplace, delete `~/.codex/plugins/cache/<mkt>`, restore `~/.codex/config.toml`.
- agy 1.4.3: plugin dir with `plugin.json` and `hooks.json` (name -> event form), matcher `.*`.
  `agy plugin install <dir>`; `agy --model claude-sonnet-4-6 --mode auto --dangerously-skip-permissions --print-timeout 250s -p '<prompt>'` (`-p` must come last, prompt attached). Flash models returned 503 "No capacity"; `--mode auto` is not available for this account (warning only).

## Findings that differ from the spec's assumptions

- Real agy 1.4.3 CLI tool names are `write_file`, `edit_file` (args `Path`, `Target`, `Replacement`; one chunk per call), `read_file`, `run_command` (arg `CommandLine`). `write_to_file`, `replace_file_content`, `multi_replace_file_content` appear in the binary/docs (other variants) but were never exposed to the model, so there are no fixtures for them: the adapter should match all of these names and accept both arg shapes (unverified for the latter).
- agy payloads: `conversationId`, `workspacePaths[]`, `modelName`, `transcriptPath`, `artifactDirectoryPath`, `stepIdx`+`toolCall{name,args}` for PreToolUse. No `cwd`: use `workspacePaths[0]`.
- Codex PreToolUse: `tool_name` is `apply_patch` (patch text in `tool_input.command`, supports multi-file with `*** Update File` and `*** Add File`) or `Bash`. Stop has `stop_hook_active`, `last_assistant_message`.

## Step 3: agy `{"decision":"ask","reason":...}`

Driven through an interactive pty (expect). The hook returned `ask` with reason `PROBE-REASON-XYZ please confirm`. A permission prompt appeared ("Requesting permission for: echo asktest / Run this command? 1. Yes ... 4. No, cancel") but the reason text was NOT displayed anywhere on screen. Also, with decision `allow` or `auto_approve`, the same prompt appeared for `echo`/`ls` (default policy prompts), so the prompt cannot be attributed to `ask`. Conclusion: reason is not shown to the user. FAIL for "ask shows a box with a reason" (spec go/no-go). Use `deny` with reason (shown to the model) for guardrails, and put user-visible explanation elsewhere.

## Step 4: agy private marketplace from git

Not supported in 1.4.3. `agy plugin link <mp> <target>` and `install plugin@mkt` say `unknown marketplace` for anything but `antigravity-plugins-official`; there is no marketplace-add command. Install targets that work: a local directory (`agy plugin install <dir>`), `agy plugin install https://github.com/<owner>/<repo>` (shells out to git, so private repos need a working git credential helper; failure for a nonexistent repo: `fatal: unable to get password from user`), and the official marketplace. `file://`, `git@github.com:...` and gitlab.com URLs are rejected ("install target must be a directory" / "currently only supports github.com"). The repo root must be the plugin (plugin.json, hooks.json). A private-GitHub clone was not exercised (no remote exists).

## Step 5: agy subagent files and alreadyContinued

- Plugin agents: `agents/<name>.md` at the plugin root (workspace: `.agents/agents/<name>.md`; global `~/.gemini/config/agents/`). YAML frontmatter then the system prompt body. Fields: `name`, `description` (required), `tools` (list, e.g. `view_file`, `grep_search`, `run_command`; a wrong tool name may hang), `subagent`, `mainAgent`, `model` (`inherit|flash|pro`), `commandExecutionPolicy`, `skills`, `mcpServers`. `agy plugin validate` counted `agents 1` for such a file.
- Stop payload carries `executionNum`: 0 for the first stop, 1 after a hook `{"decision":"continue","reason":...}` (see `agy/stop.json` vs `agy/stop-after-continue.json`). So alreadyContinued = `executionNum > 0` within a turn; no state file needed (caveat: not tested whether it resets on a new user turn in the same conversation).
