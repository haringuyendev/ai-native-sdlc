---
name: agents-md
description: Use when an agent repeats the same mistake a second time, when a review flags AGENTS.md as outdated, or when the user asks to update or trim AGENTS.md, or when the user states a standing rule or convention for this repo (from now on, always, never)
---

# Maintaining AGENTS.md

Keep `AGENTS.md` short, true and useful: add what agents keep getting wrong, remove what has gone stale. `AGENTS.md` is the root instruction file for Claude Code, Codex and Antigravity; `CLAUDE.md` (imports `AGENTS.md`) is only the line `@AGENTS.md`. The structure comes from `<plugin root>/templates/AGENTS.md`.

## When to use
- An agent made the same mistake a second time.
- A review flags `AGENTS.md` as outdated.
- The user asks to update or trim `AGENTS.md`.
- The user states a standing rule or convention for this repo ("from now on…", "always…", "never…").

## Steps
1. **Identify the mistake or convention.** Record it only when it is the **second occurrence** (check `review.md`, `sdlc/lessons/` and the Log) or when the user asks for it or states the rule.
2. **Choose where it goes.**
   - A repo convention, command or frequent mistake goes in `AGENTS.md`.
   - An organizational policy that has an owner goes in a policy skill (`ai-native-sdlc:policy`).
   - Something that must never happen needs a hook or a gate: propose it to the user.
3. **Edit `AGENTS.md`.** Keep the structure of `<plugin root>/templates/AGENTS.md`. Write one line per item, specific, stating the correct way (for example "Money is BigDecimal, never double"). Repeated mistakes go under `## Things agents get wrong`. Never put content in `CLAUDE.md` other than `@AGENTS.md`.
4. **Keep it under one page.** Delete stale lines (a command that no longer runs, a problem that is gone) and merge duplicates. Run the build, test and lint commands to confirm they work; for other commands (dev servers, deploys, anything long-running or destructive) only check that they still exist — do not run them.
5. **Show the diff.** Commit as `docs(agents-md): <summary>`. The code owner approves it through review, like code.
6. **Log it.** If you are inside a change, add one line to the Log in `progress.md`.

## Rules
- At most one page.
- No secrets.
- Do not copy content that already lives in a skill.
- Every command listed must run.
- Every line under "Things agents get wrong" states the correct behavior.
- Do not add anything that happened only once.

## Output and handoff
The edited `AGENTS.md` and one commit. Then return to the skill that was in progress.
