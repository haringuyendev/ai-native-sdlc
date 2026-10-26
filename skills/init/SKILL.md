---
name: init
description: Use when setting up the AI-native SDLC harness in a repository that has no sdlc/config.json, or when the user runs /ai-native-sdlc:init
---

# Setting up the SDLC harness

Templates live in `templates/` under the plugin root given in your session context. Never overwrite an existing file without showing the diff and getting a yes.

## Checklist
1. **Confirm the repo.** Must be a git repository at its root. If `sdlc/config.json` exists, stop: the harness is already set up — offer `/ai-native-sdlc:status` instead.
2. **Discover verify commands.** Read package.json / Makefile / pyproject / build files. Propose build, test, lint and single-test commands; ask the user to confirm or correct them.
3. **Mention guardrails, do not interview.** Blocking guardrails (`gates`, the secret scan, `protected_paths`) are off by default; say so in one sentence and point to the README section "Bật/tắt guardrail". Only if the user wants them on, ask which paths are frozen and which commands need approval, take the sample gates verbatim from that README block (keep their `prefixes`, which give Codex an execpolicy rule since it cannot ask from a hook), and set `"secret_scan": true` if they want the secret scan.
4. **Write `sdlc/config.json`** from the template with the confirmed values.
5. **Create folders** `sdlc/changes/`, `sdlc/lessons/`, `sdlc/evals/`, each with a `.gitkeep`.
6. **AGENTS.md and CLAUDE.md.** `AGENTS.md` is the root instruction file for Claude Code, Codex and Antigravity; `CLAUDE.md` is only the line `@AGENTS.md`.
   - Neither exists: analyze the codebase as `/init` would, then write `AGENTS.md` in the structure of `templates/AGENTS.md`, under one page. Keep only what a new joiner needs on day one.
   - Only `CLAUDE.md` exists with content: its content moves to `AGENTS.md` and `CLAUDE.md` becomes `@AGENTS.md`; add the missing sections `## Verifying your work`, `## Things agents get wrong`, `## SDLC harness` from the template. Show the diff and get a yes.
   - Both exist: keep both; only add missing sections to `AGENTS.md`, with the diff.
7. **REVIEW.md** from the template; ask whether any pass or "Do not report" path should change.
8. **Sync agent files.** Run `node scripts/sync-agent-files.mjs --dry-run` (script under the plugin root given in your session context) from the repo root to show the diff, then rerun with `--yes` once the user agrees. It writes `CLAUDE.md` (imports `AGENTS.md`), `.codex/rules/ai-native-sdlc.rules` (from the gate `prefixes`) and the verifier subagent for each agent: `.claude/agents/verifier.md`, `.codex/agents/verifier.toml`, `.agents/agents/verifier.md`. Existing verifiers are never overwritten.
9. **Commit** everything: `sdlc: init harness`.
10. **Tell the user** what was created, that the next session will show the status board, and that new work starts with describing the idea (`ai-native-sdlc:intent`). If the team has written policies (security, API, UX), offer `ai-native-sdlc:policy` to encode the first one. Mention that incidents become lessons (`ai-native-sdlc:lesson`) and regression evals (`ai-native-sdlc:eval`).
