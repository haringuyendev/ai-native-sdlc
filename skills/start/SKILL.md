---
name: start
description: Use when starting any conversation in a repo - establishes the AI-native SDLC loop (intent → spec → plan → build → review → lessons), how to find and use skills, and how to keep sdlc/changes progress current
---

# Using the AI-Native SDLC harness

This repo's work moves through one loop. Every stage ends by committing an artifact the next stage reads; together they are the audit trail and the handoff for whoever comes next.

```
intent.md → spec.md → plan.md → code + tests → review.md → done
    ↑                                                       │
    └──────── sdlc/lessons/ (incident, bug, repeated mistake)┘
```

## The rule
Before acting on any request, check whether a skill below applies and invoke it the way your session context says (it names how your agent invokes skills). Invoking the skill is your first action: do not read, search or run anything to judge first whether the skill is needed or the stage is already done. The skill checks the change's state itself and tells you when there is nothing to do. User instructions and `AGENTS.md` (`CLAUDE.md` imports it) override skills; skills override defaults.

Paths written as `<plugin root>/...` mean the plugin root given in your session context (`Plugin root: <path>.`). Skill names are written `ai-native-sdlc:<name>`; invoke them as your session context describes (`$<name>` in Codex, `/<name>` in Antigravity, the skill mechanism in Claude Code).

## Where am I?
The session context contains an `<sdlc-status>` block listing open changes. If the user continues existing work, invoke the skill for the step they ask for (or `ai-native-sdlc:resume <change>` when they just want to carry on); the skill reads that change's `progress.md`, `intent.md`, `spec.md`, `plan.md` before doing anything. Never restart a stage that already has an accepted artifact.

## Routing
| Situation | Skill |
|---|---|
| Repo has no `sdlc/config.json` and the user wants the harness | `ai-native-sdlc:init` |
| New idea, ticket, or request with no change folder yet | `ai-native-sdlc:intent` |
| Accepted intent, needs requirements and design | `ai-native-sdlc:spec` (writes spec.md) |
| Accepted spec, needs a plan | `ai-native-sdlc:plan` |
| Accepted plan, needs an isolated workspace | `ai-native-sdlc:worktree` |
| Accepted plan, implement it | `ai-native-sdlc:build` or `ai-native-sdlc:run` |
| Writing any code | `ai-native-sdlc:tdd` |
| Bug, failing test, unexpected behavior | `ai-native-sdlc:debug` |
| About to say work is done | `ai-native-sdlc:verify` |
| Implementation finished, needs review | `ai-native-sdlc:review` (passes from REVIEW.md) |
| Review findings or PR comments to handle | `ai-native-sdlc:fix-review` |
| Review done, integrate the branch | `ai-native-sdlc:finish` |
| 2+ independent problems | `ai-native-sdlc:parallel` |
| Encoding an org policy (security, API, UX) | `ai-native-sdlc:policy` |
| The agent made the same mistake twice | `ai-native-sdlc:agents-md` |
| Continuing an open change, or picking up someone else's | `ai-native-sdlc:resume` |
| User asks to see the status board or which changes are open | `ai-native-sdlc:status` |
| Incident, escaped bug, post-mortem | `ai-native-sdlc:lesson` |
| Guarding agent behavior with a regression check | `ai-native-sdlc:eval` |
| User states a standing rule ("from now on…", "always/never…", a coding or architecture standard) | `ai-native-sdlc:agents-md` for this repo, `ai-native-sdlc:policy` for an org rule with an owner — write it to the repo, not to auto memory |

## Change folders
- One folder per change: `sdlc/changes/<YYYY-MM-DD>-<slug>/` with `intent.md`, `spec.md`, `plan.md`, `review.md`, `progress.md`.
- Ceremony scales: architectural → full chain; bounded → short intent.md plus design and plan inside progress.md; spike (a small, clear task) → no folder, just do it.
- Artifacts are written in Vietnamese under the fixed English headings from the templates.

## Keeping progress.md current
- `stage` is one of `intent | spec | plan | build | review | done | dropped`. Move it only after the human explicitly accepts the artifact (except `review`, which `ai-native-sdlc:review` sets when review.md is written); record `approvals.<stage>: { by, at }` and commit `sdlc(<slug>): <stage> accepted`.
- Tick `- [x]` in plan.md as each task completes.
- Before ending a session that touched code, append `### <YYYY-MM-DD> — <person> + <agent>` under `## Log`: what was done, commits, what is unfinished, risks. Update `next`. A Stop hook reminds you if you forget.
- Set `blocked_by` when waiting on someone; clear it when unblocked.

## Guardrails
Hooks block edits to `protected_paths`, secrets in file content, and ask before commands matching `gates` (all in `sdlc/config.json`), and edits to test files while the change's `test_lock: true` (set per change in its progress.md). When a hook blocks, explain the reason to the user and follow the route it names; never work around it.
