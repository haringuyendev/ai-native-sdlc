---
name: eval
description: Use when guarding agent behavior with a regression check - turning a real task or an incident into an eval, changing AGENTS.md, skills, hooks or policies and needing proof the agent still behaves, or running and pruning the eval suite
---

# Writing and running evals

Turn one real behavior into a deterministic regression check that runs the agent chosen with `--agent` (default `claude-code`) in a throwaway worktree. The template is `<plugin root>/templates/eval.json`; evals live in `sdlc/evals/<name>.json`.

## When to use
- A recently accepted task, an incident or a skill trigger should be guarded against regression.
- `AGENTS.md` (`CLAUDE.md` imports it), a skill, a hook, `.claude/**` or a policy changed and you need proof the agent still behaves.
- The suite needs to be run in full or pruned.

## Steps
1. **Pick the case, one behavior per eval.** Use a recent real task that was accepted (prompt plus an acceptable result), an incident (it has a lesson), or a skill trigger. The long-term goal is 20-50 cases drawn from real work.
2. **Write `sdlc/evals/<name>.json`** from `<plugin root>/templates/eval.json`.
   - Required fields: `name` (equals the file name), `description`, `source` (`task | incident | trigger`), `prompt`, `checks`. `source: incident` also requires `lesson`, the path of the lesson file.
   - Optional fields: `max_turns` (default 10), `timeout_sec` (default 600), `allowed_tools`, `args` (array of extra `claude` arguments).
   - Check types and their fields:
     - `skill_first` / `skill_never`: `skill`, the full name `ai-native-sdlc:<name>`.
     - `output_includes` / `output_excludes`: `text`, matched against the final result.
     - `command`: `run`, a shell command run in the eval worktree after `claude` finishes; optional `expect_exit` (default 0).
   - Prefer deterministic checks: `command` (tests pass, lint clean, grep for a policy) and `skill_first` / `skill_never`. Use `output_includes` / `output_excludes` sparingly.
   - `description` says why each check would fail if the behavior broke.
   - `allowed_tools` both restricts and pre-approves: only the tools it names are available (`--tools`), and its rules are approved without asking (`--allowedTools`); every other tool call is denied (`--permission-mode dontAsk`). Keep it as narrow as possible. Include `Write` if the task creates files and `Skill` if a check expects a skill.
   - `command` checks and `args` run as ordinary code with your environment and permissions (for example `args: ["--dangerously-skip-permissions"]` removes the sandbox). Review eval files like test code, especially in pull requests.
   - Pass `--agent <claude-code|codex|agy>` to `run-evals.mjs` to run the eval under another agent (default `claude-code`); skill names are compared without the `ai-native-sdlc:` prefix. For `codex` and `agy` the runner does not install the plugin, so ai-native-sdlc must already be installed in that agent; `--plugin-dir-from-head` stays Claude-only, as do an eval's `allowed_tools` and `args` (Codex reads the model from `AI_SDLC_CODEX_MODEL`, agy from `AI_SDLC_AGY_MODEL`). `max_turns` is Claude-only: `codex exec` and `agy -p` have no turn cap and often hit `timeout_sec`; such a run is graded on the stream captured so far (skill checks only), and fails as a timeout if no skill was invoked. Codex runs with `-s workspace-write` and `--dangerously-bypass-hook-trust`, emulating a user who trusted the hooks; agy runs with `--dangerously-skip-permissions` because headless agy auto-denies every shell command (the run stays in the throwaway worktree and PreToolUse denials still apply, but a gate's "ask" is auto-approved). A skill counts as used only when a read-like command or tool opens `<...>/ai-native-sdlc/.../skills/<name>/SKILL.md` (`start` excluded).
3. **Validate:** `node <plugin root>/scripts/run-evals.mjs --dry-run`.
4. **Run:** `node <plugin root>/scripts/run-evals.mjs --only <name>` (`--only` matches a name prefix). This costs API usage: it runs a real agent session (`--agent`, default `claude-code`) in a temporary worktree at HEAD, so commit first. HEAD applies to the repo's own files (`AGENTS.md`, `.claude/**`, code); plugins, including this one, come from the installed copy. To evaluate a plugin's own changes, run from the plugin repo with `--plugin-dir-from-head <subdir>` (`.` for the repo root) and disable the installed copy for that run (`claude plugin disable ai-native-sdlc@ai-native-sdlc`, then `claude plugin enable ai-native-sdlc@ai-native-sdlc` afterwards). `--root <dir>` runs the evals of another checkout instead of the current one.
   For an incident eval, confirm it FAILS on the configuration from before the fix. The eval file is read from the checkout's disk, while `claude` runs on that checkout's HEAD, so:
   ```bash
   BEFORE=$(mktemp -d)/before-fix
   git worktree add --detach "$BEFORE" <commit-before-fix>
   cp sdlc/evals/<name>.json "$BEFORE/sdlc/evals/"
   node <plugin root>/scripts/run-evals.mjs --root "$BEFORE" --only <name>   # expect FAIL
   git worktree remove --force "$BEFORE"
   ```
   The "uncommitted changes" warning there is expected (the copied eval file). If the old commit has no `sdlc/config.json`, copy that too. If it still passes, the checks do not catch the incident: tighten them.
5. **Commit** as `eval(<name>): add`.
6. **When `AGENTS.md`, a skill, a hook, `.claude/**` or a policy changes,** run the whole suite (`node <plugin root>/scripts/run-evals.mjs`, optionally `--min-pass <0..1>`) before merging. If the change is to a plugin's skills or hooks, add `--plugin-dir-from-head` as in step 4, otherwise the run grades the installed plugin, not the change. Record the pass rate in the change's Log. If the pass rate dropped, put it in front of the reviewer before merging.
7. **Prune the suite.** A case that no longer discriminates (always passes across many runs and models) is removed, with the reason in the commit `eval(<name>): retire`. An incident eval is retired only when the lesson's owner agrees.

## Rules
- No secrets or customer data in a prompt.
- No LLM-judge in v1; checks are deterministic.
- An eval never touches production.
- One behavior per eval.
- Never edit a check to make it pass when the real behavior is broken.

## Output and handoff
The eval file and its commit, plus the pass rate in the change's Log. Return to the skill that was in progress, usually `ai-native-sdlc:lesson`.
