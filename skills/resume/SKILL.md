---
name: resume
description: Use when the user wants to continue work on an open change, runs /ai-native-sdlc:resume [change], or picks up a change someone else started
---

# Resuming a change

Rebuild the state of an open change from its files and from git, summarize it, and propose the next skill. It changes no tracked file.

## When to use
- The user wants to continue work on an open change.
- The user runs `/ai-native-sdlc:resume [change]`.
- The user picks up a change that someone else started.

## Steps
1. **Pick the change.** Use the argument if there is one. Otherwise use the `<sdlc-status>` block, or run `node <plugin root>/scripts/sdlc-status.mjs`. If several changes are open and the user did not name one, ask one question that lists each slug, its stage and its owner.
2. **Read the artifacts.** Read `progress.md` in full: the frontmatter and the whole `## Log`, newest entry first. Then read `intent.md`, `spec.md` (bounded: `## Design`), `plan.md` (bounded: `## Plan`) and `review.md` if it exists.
3. **Check git.** Note the current branch, the output of `git worktree list`, the branch or worktree that belongs to the change, uncommitted files, and commits that are not merged yet.
4. **Read the build ledger.** If the stage is build, run `bash ../build/scripts/sdd-workspace <PLAN_FILE>` (PLAN_FILE is `sdlc/changes/<slug>/plan.md`, or `progress.md` for a bounded change). Run it from the change's worktree or branch found in step 3 (`cd <worktree>`). If the branch has no worktree, read plan.md and the ledger state through `git show <branch>:<path>` (the ledger is git-ignored and lives only in the worktree; if there is no worktree, say the ledger is unavailable and rely on plan.md ticks and git log). If a `ledger.md` exists, read its `Task <N>: complete` lines and its `Ruling:` lines.
5. **Summarize in 10 lines or fewer.** Give the stage, the approvals that exist, tasks x/y (counted from that checkout's plan file, not the main checkout's status board), the last Log entry (who, when, what is still open), `blocked_by`, any Important finding that is still open, and `next`.
6. **Check `blocked_by` first** (any stage can be blocked). If it is not empty, name who must unblock the change and stop. Otherwise propose the next skill, by stage.
   - intent: `ai-native-sdlc:intent`
   - spec: `ai-native-sdlc:spec`
   - plan: `ai-native-sdlc:plan`
   - build: `ai-native-sdlc:worktree`, then `ai-native-sdlc:build` or `ai-native-sdlc:run`, continuing from the first task that is not complete
   - review: `ai-native-sdlc:review` or `ai-native-sdlc:fix-review`
   - any other stage (`done`, `dropped`): say so and ask what the user wants

   Wait for the user to agree, unless they already said to carry on.

## Rules
- Never redo a stage that already has an approved artifact.
- Never dispatch again a task that the ledger marks complete.
- Trust the ledger and `git log` over memory.
- Never edit an artifact while you are only reading it to resume.
- Never guess when the Log contradicts git: tell the user.

## Output and handoff
The summary and the proposed next skill.
