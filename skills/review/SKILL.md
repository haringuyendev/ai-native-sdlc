---
name: review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements - reviews the branch against REVIEW.md, spec.md and plan.md and writes review.md
---

# Whole-branch review

Have one fresh reviewer read the finished branch against the repo's review rubric, the spec and the plan, then record what it found in the change's `review.md`.

## When to use
Required:
- Every checkbox in the change's plan has been ticked. This is the normal entry point, and both `ai-native-sdlc:build` and `ai-native-sdlc:run` end here.
- A major feature has just been completed.
- The branch is about to be merged into main.

Worth doing even when nobody requires it:
- You are stuck and a cold reader might see what you no longer can.
- You are about to refactor and want a baseline judgment first.
- You have just landed a fix for a complicated bug.

Not for the per-task gate inside `ai-native-sdlc:build`: that gate has its own task-reviewer prompt in the build folder.

The habit behind all of these: ask for review early and ask often. A defect caught now does not get copied into the next three tasks.

## Steps

### 1. Fix the range and build the package
`PLAN_FILE` is `sdlc/changes/<slug>/plan.md`. A bounded change has no plan.md; there `PLAN_FILE` is `sdlc/changes/<slug>/progress.md`, whose `## Design` and `## Plan` sections stand in for the spec and the plan.

```bash
BASE_SHA=$(git merge-base <base-branch> HEAD)
HEAD_SHA=$(git rev-parse HEAD)
bash ../build/scripts/review-package PLAN_FILE "$BASE_SHA" HEAD
```

The range starts at `git merge-base <base-branch> HEAD`, so the reviewer sees the whole branch and nothing that was already on the base. The last line prints the path of a package file inside the plan's SDD workspace. That path becomes `[PACKAGE_FILE]`.

### 2. Gather what the reviewer reads
| Placeholder | Fill it with |
|---|---|
| `[DESCRIPTION]` | two or three sentences on what the branch delivers |
| `[PLAN_OR_REQUIREMENTS]` | what the branch was supposed to achieve: the plan path, or the requirement text |
| `[BASE_SHA]` | the merge-base commit from step 1 |
| `[HEAD_SHA]` | the branch tip from step 1 |
| `[PACKAGE_FILE]` | the path `review-package` printed |
| `[REVIEW_MD]` | the repo's `REVIEW.md`, pasted unchanged |
| `[SPEC_FILE]` | the change's spec.md (bounded change: progress.md, `## Design`) |
| `[PLAN_FILE]` | the change's plan.md, Review Focus included (bounded change: progress.md, `## Plan`) |
| `[POLICIES]` | each policy the spec names under "Policies applied" |
| `[LEDGER_NOTES]` | every `Ruling:` line and every `minor (deferred)` line from the ledger |

No `REVIEW.md` in the repo? Then `[REVIEW_MD]` carries a default rubric instead: three passes (Bugs, Security, Compliance) and two levels (Important, Nit). Write into it, in plain words, that this is a default because the repo has no `REVIEW.md`, so the reviewer and the reader of review.md both know.

Give the reviewer file paths and pasted text only. Do not hand it your conversation, your reasoning or a summary of the session: it must judge the work product as a stranger would, and session history pulls it toward your view of the code.

### 3. Dispatch one reviewer
Fill [code-reviewer.md](code-reviewer.md) and send it through your agent's subagent mechanism to exactly one fresh subagent. Name the model in the dispatch: the most capable one available. A dispatch without a model inherits the session default, which is not a choice you made.

Do not read the diff and judge it yourself as a shortcut. A branch-sized diff, plus the reasoning about it, can crowd out most of your working memory; steps 4 to 6 and the fix-review that follows would then run on whatever is left. Let the diff live in the reviewer's context and take back only its findings.

Exception: when no subagent tool exists at all, `ai-native-sdlc:run` performs this review itself and writes `Final review: self-review (no subagent tool)` into both the ledger and review.md.

The reviewer works read-only and dispatches nobody. It compares the branch with the plan, inspects quality, architecture, tests and production readiness, treats the spec as a vision document, triages each ledger note, lists what it declined to judge, and ends with a verdict. Its report has fixed sections: Strengths, Issues grouped by pass, Recommendations, Assessment with `Ready to merge?`.

### 4. Write review.md
Create `sdlc/changes/<slug>/review.md` from `<plugin root>/templates/review-report.md`:
- Header: `Range: <base7>..<head7>`, who reviewed (model or person), the date.
- Findings table, columns `# | Pass | Mức | File:line | Vấn đề | Status`. One row for each finding; every new row starts at Status `open`.
- Severity follows `REVIEW.md`. Under the default rubric, the reviewer's Critical and Important both land as Important and its Minor lands as Nit. When Nits exceed the rubric's cap, write the overflow as a count rather than as rows.
- `## Declined to judge`: copy the reviewer's list, one line per item with its reason.
- `## Verdict`: the merge verdict and its one or two sentences of reasoning.

Status takes exactly one of: `open`, `fixed <sha>`, `won't fix: <reason>`, `needs decision`.

### 5. Record the stage
In progress.md set `stage: review` and a `next` that names the handoff below, append a Log entry, and commit everything as `sdlc(<slug>): review written`. Writing review.md is itself what sets this stage.

### 6. Hand off
- Any finding in the table: go to `ai-native-sdlc:fix-review`.
- An empty table: go to `ai-native-sdlc:finish`.

## Rules
How to treat what comes back:

| Severity | What you do |
|---|---|
| Critical | Fix it now, before anything else. |
| Important | Fix it before moving on. |
| Minor / Nit | Write it down for later. |

- Do not call a change too simple to review. Small diffs hide wrong assumptions just as well.
- Do not set a Critical aside, and do not move on while an Important is unfixed.
- Do not argue against feedback that is technically valid.
- When the reviewer is wrong, say why with technical reasoning, point at the code or the test that shows the behavior works, or ask the reviewer what it meant. A bare "disagree" settles nothing.

Example, after the last task of a change that adds CSV export to a reports page:

```
BASE_SHA=$(git merge-base main HEAD)          -> 4c1e9b2
HEAD_SHA=$(git rev-parse HEAD)                -> 8d07a3f
bash ../build/scripts/review-package sdlc/changes/2026-03-02-csv-export/plan.md 4c1e9b2 HEAD

Dispatch (most capable model):
  DESCRIPTION: Export button on /reports; server streams CSV with the visible filters applied
  PLAN_OR_REQUIREMENTS: sdlc/changes/2026-03-02-csv-export/plan.md
  BASE_SHA: 4c1e9b2   HEAD_SHA: 8d07a3f

Report, condensed:
  Strengths: streaming keeps memory flat; filter parsing reused, not copied
  Issues (Bugs):  Important  export.ts:58  cell starting with "=" is written raw (formula injection)
  Issues (Compliance): Minor  ReportsPage.tsx:120  button label differs from spec R3
  Assessment: With fixes

review.md: two rows, both open -> commit "sdlc(csv-export): review written" -> fix-review
```

## Output and handoff
- `sdlc/changes/<slug>/review.md`, one row per finding, all `open`.
- progress.md with `stage: review`, `next` and a Log entry; one commit `sdlc(<slug>): review written`.
- The review package stays in the SDD workspace, outside git.

Findings go to `ai-native-sdlc:fix-review`; a clean table goes to `ai-native-sdlc:finish`.
