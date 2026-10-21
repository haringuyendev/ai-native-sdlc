---
name: build
description: Use when carrying out an implementation plan in this session where the tasks are mostly independent of each other, handing each task to its own subagent
---

# Building with subagents

You act as controller: a fresh implementer subagent takes each plan task, a scoped review (spec compliance plus quality) checks it, and one whole-branch review closes the change.

## When to use

Use this skill when all of these hold:
- an accepted plan exists and its tasks are mostly independent;
- your human partner did not ask for inline execution, and your agent has a subagent mechanism;
- the change's progress.md says `stage: build` and carries `approvals.plan`.

Go elsewhere otherwise:

| Situation | Go to |
|---|---|
| Partner chose inline, or no subagent mechanism exists | `ai-native-sdlc:run` |
| No plan yet, or the tasks are tightly coupled | manual execution, or brainstorm a spec first |
| `stage` is not `build`, or `approvals.plan` is missing | `ai-native-sdlc:plan` |

Do not start implementing on main or master unless your human partner explicitly agreed. `reference.md` in this folder holds the flow diagram, the full model-tier guidance, the rationalization table, a worked session and a comparison with `run`.

## Steps

### 0. How you run

You execute the whole plan in one pass. Between tasks there is no check-in, no progress recap and no "shall I go on?". Between tool calls write one short line at most; the ledger and tool output are the record.

When something is unclear, contradictory or wrong in the plan, or you would want to exceed a cap, decide it yourself and keep moving. Authority order: spec first, then plan, then your judgment for what both leave open. Write each decision to the ledger as
`Ruling: <what you decided> — <why> — <what it costs if wrong>`.

Exactly four things justify stopping to ask:

| # | Stop reason |
|---|---|
| a | an operation that is destructive or cannot be undone |
| b | a security-sensitive action |
| c | a side effect beyond this worktree that norms say to ask about first: merging, pushing to a shared branch, publishing |
| d | a plan so broken that any way forward is guesswork |

A denial from a guardrail hook (protected path, test_lock, secret) is reason (b): report it and do not route around it. Before stopping for any reason, append the progress.md Log entry described in step 13. Finishing every task is the only other end.

### 1. Set up the workspace and ledger

1. Invoke `ai-native-sdlc:worktree` to create the isolated workspace or confirm the current one.
2. Fix PLAN_FILE: `sdlc/changes/<slug>/plan.md`; when the change is bounded, `sdlc/changes/<slug>/progress.md` instead (there `## Design` acts as the spec and `## Plan` as the plan).
3. From this skill's folder run `bash scripts/sdd-workspace PLAN_FILE`. It prints `<repo-root>/.ai-sdlc/sdd/<slug>/`, the git-ignored folder that owns this plan's ledger, briefs, reports and review packages (its `plan-path` file names the owner). Never touch a folder that belongs to another plan.
4. Inspect `<workspace>/ledger.md`:
   - First line names your PLAN_FILE: every task with a `Task <N>: complete` line is finished; never dispatch it again. Continue from the first task lacking that line. If a task's last line is a fix round, continue its loop at the following round.
   - First line names some other plan: that ledger is not yours. Leave it where it is and start a fresh one of your own.
   - No ledger: create it, first line `# SDD ledger — plan: <plan file path>`.
5. After a context compaction, believe the ledger and `git log`, not your memory. If `git clean -fdx` wiped the workspace, rebuild your position from `git log`.

### 2. Read the inputs once

Read progress.md and intent.md, then spec.md and plan.md (bounded change: the `## Design` and `## Plan` sections of progress.md). Note the plan's context and its Global Constraints. Read the spec the plan names. If no spec can be reached, write a ledger note that every ruling is provisional. Create one todo per task.

### 3. Pre-flight conflict scan

Before Task 1, check the plan and write the result into the ledger as a table:

| Row kind | Columns |
|---|---|
| each two tasks touching one common file or interface | task A and task B; what A produces vs what B consumes; finding |
| one per task | whether its own text agrees: tests vs code it specifies, files it creates vs files it touches later; finding |

While scanning, also look for tasks that contradict each other or the Global Constraints, and for anything the plan orders that the review rubric counts as a defect (a test with no real assertion, a logic block duplicated verbatim). Rule on every finding against the plan text that causes it, before any dispatch, and put the ruling beside its row. When nothing turns up, go on to Task 1 without remarks.

### 4. Model Selection

Name a model on every single dispatch; a dispatch without one inherits the session's model, usually the priciest. Pick the cheapest tier that can do the job:

| Role | Tier |
|---|---|
| Mechanical task where the plan text already contains the full code, or a fix inside one file | cheapest |
| Mechanical task: 1-2 files with a complete spec | cheap |
| Integration or judgment across several files | standard |
| Architecture or design work, and the final whole-branch review | most capable |
| Task reviewer | scaled to diff size and risk, never below mid-tier |
| Scoped re-review of a small fix diff | cheap to mid |
| Fix rounds 4-5 | at least one tier above the implementer that got stuck |

Fewer turns beat cheaper tokens: on multi-step work the cheapest model often needs two or three times as many turns. Details in `reference.md`.

### 5. Batch small identical edits

If several tasks are tiny, independent edits of one shape (the same constant, field or one-liner across files), send ONE dispatch that lists each file and its change to a single subagent, and review the result as one diff. Everything else gets one dispatch per task. Implementers always run one at a time.

### 6. Dispatch the implementer

1. Record BASE with `git rev-parse HEAD`.
2. Task brief: run `bash scripts/task-brief PLAN_FILE N`. It writes `.ai-sdlc/sdd/<slug>/task-N-brief.md` and prints the path.
3. Fill [implementer-prompt.md](implementer-prompt.md). The dispatch holds only:
   - one line placing the task in the project (the `[Scene-setting: where this fits, dependencies, architectural context]` slot);
   - the brief path, flagged "read first; copy its exact values verbatim";
   - anything settled in prior tasks (interfaces, choices) that the brief has no way to know;
   - how you resolved any ambiguity you saw in the brief;
   - the report path `task-N-report.md` next to the brief, plus the report contract;
   - a pointer to any ledger entry an earlier task parked in the area this task touches.
4. Keep the agent id the dispatch returns for this implementer; fix rounds 1-3 resume that agent.

### 7. Act on the returned status

**DONE:** run `bash scripts/review-package PLAN_FILE BASE HEAD` with the BASE from step 6, then dispatch the task reviewer (step 8) with the printed path.

**DONE_WITH_CONCERNS:** read the concerns before anything else. Does a concern question whether the code is correct, or whether the task stayed in scope? Then settle it before the review is dispatched. Is it only a remark, such as "the parser file passed 600 lines"? Then note it and send the task to review as usual.

**NEEDS_CONTEXT:** give the missing information and dispatch again.

**BLOCKED:** diagnose, then change something:
1. missing context → add it, same model;
2. needs deeper reasoning → a more capable model;
3. task too big → split it;
4. plan is wrong → rule on the fix, ledger it, dispatch again carrying the ruling.

If the implementer asks a question, before starting or midway, answer it fully and add context as needed. Do not push it to start coding before its questions are settled.

### 8. Review the task

Fill [task-reviewer-prompt.md](task-reviewer-prompt.md) with three paths (the brief, the report file, the review package) and a global-constraints block copied verbatim from the plan's Global Constraints or the spec: exact values, exact formats, the R# requirements, and stated relationships such as "same layout as X". The template already carries the process rules.

Require both verdicts back: spec compliance AND task quality. A reviewer may list `⚠️ Cannot verify from diff` items (requirements in unchanged code, or spanning tasks). Settle each yourself before completing the task. Any you confirm as a real gap counts as a failed spec review and joins the fix loop.

### 9. Fix loop

The loop starts when any of these come back: spec ❌; a finding rated Critical or Important; a ⚠️ gap you confirmed. Two kinds of finding leave first:
- Minor: ledger `Task <N>: minor (deferred): <one-liner>` and carry on. Minors never enter the loop; the final review gets this list.
- Labeled plan-mandated, or clashing with the plan text: weigh it against the plan, decide with the spec as binding authority, and ledger the ruling before acting either way.

Everything else loops, five rounds at most. One round is one fix dispatch followed by one scoped re-review.

| Round | Who fixes |
|---|---|
| 1-3 | Resume the original implementer and send the open findings verbatim. If your harness cannot message a live subagent, dispatch a fresh implementer with the brief path, the report path and the findings. |
| 4-5 | A fresh implementer on a model at least one tier above the stuck one (step 4), given the brief path, report path, open findings and this framing: "Another implementer has tried this task N times and it is now yours. Read the report file first to see what was tried." |

In every round the implementer makes the fix, runs again the tests that cover what changed, adds a fix section at the end of its existing report file, and returns the short contract. Name those covering test files in your fix message. Before re-review, check the fix report shows the tests, the command and its output.

Re-review: FIX_BASE = the last commit the prior review looked at. Run `bash scripts/review-package PLAN_FILE FIX_BASE HEAD` and dispatch [re-review-prompt.md](re-review-prompt.md), handing it four things: open findings, brief, report file, and the diff path just printed. Each finding comes back ADDRESSED or NOT ADDRESSED. New Critical or Important breakage inside the fix diff joins the open list; observations outside it go to the ledger as deferred minors and never add a round.

After each round, append:
`Task <N>: fix round <R>/5 (<X> addressed, <Y> open — <finding one-liners>; commits <a7>..<b7>)`

**Breaker.** Only when findings survive the round-5 re-review: dispatch nothing more and judge each one yourself.

| Verdict on the finding | Ledger |
|---|---|
| Reviewer wrong, or the point is arguable | `Task <N>: parked — <finding> — Ruling: <why the code stands>`. Parking is safe because the final review reads the finding and your ruling side by side. |
| Genuine, yet nothing later relies on it | the same parked line; its ruling states genuine, deferred |
| Genuine and load-bearing: later work depends on it, or the plan itself turns out defective | choose the smallest change that unblocks dependents; `Task <N>: Ruling: <finding> — <what you decided and why>`; carry it into the next task's dispatch |

Stop here only if the defect leaves every way forward a guess. Every judgment is a ledger line.

### 10. Complete the task

When the review is clean, or the breaker has parked all remaining findings with rulings, do all of this in one message:
- append `Task <N>: complete (commits <base7>..<head7>, review clean)`, or `Task <N>: complete (commits <base7>..<head7>, <K> parked)` after the breaker;
- in plan.md (bounded: the `## Plan` section of progress.md), mark that task's step checkboxes `- [x]`, touching only lines outside fenced code;
- mark the todo done.

### 11. Next task, and waiting

More tasks left: return to step 6. While a subagent is running, use the time for whatever local work is pending, for example drafting the global-constraints block for the coming review or reading the previous task's report. When nothing is left to do, wait in bounded stretches of five to ten minutes. Between stretches post one status line and reconcile live children, chasing any that ended without reporting. Do not poll a wait interface on short timeouts. Do not sit in one silent, open-ended wait.

### 12. Final review

Invoke `ai-native-sdlc:review` for the whole branch on the most capable model. That skill packages the branch itself, judges against REVIEW.md, spec.md, plan.md (bounded change: `## Design` / `## Plan`), records review.md and moves the change to `stage: review`. Tell it where the ledger's deferred-minor and parked lines are.

Process its findings with `ai-native-sdlc:fix-review`. If the review comes back with any findings, send the whole list to a single fix subagent (never a fixer per finding), then run exactly one scoped re-review (`bash scripts/review-package PLAN_FILE FIX_BASE HEAD` over the fix range, plus [re-review-prompt.md](re-review-prompt.md)). Treat leftover findings the way the breaker does: park each with a ruling, or for a load-bearing one decide and write the ruling down. Only the four stop reasons halt you here. Residual load-bearing findings go to your human partner when finish presents its options.

### 13. Finish bookkeeping

1. Copy into the final message, under the heading "Rulings I made", every ledger line that contains `Ruling:`, whatever its source (pre-flight, parked, breaker). Keep the order you made them in, show each one's cost if wrong, and leave none out.
2. Under `## Log` of progress.md, append an entry headed `### <YYYY-MM-DD> — <person> + <agent>` (agent name from your session context) with those rulings, the deferred minors, the commits and what is unfinished. Update `next`.
3. Commit with message `sdlc(<slug>): build log`.
4. Invoke `ai-native-sdlc:finish`. It deletes this plan's workspace; sibling folders stay.

## Rules
- Do not pause between tasks or ask whether to continue. Stop only for the four reasons in step 0.
- Do not implement on main or master without explicit consent.
- Do not re-dispatch a task the ledger marks complete.
- Do not dispatch without an explicit model.
- Do not run two implementers at once.
- Do not paste earlier tasks' history into a dispatch; pass artifacts as files. Do not make a subagent read the whole plan.
- Implementers do not dispatch subagents of their own, reviewers included.
- Do not skip a task review, and do not accept one missing either verdict. Implementer self-review is no substitute.
- Do not dispatch a reviewer without a diff file, and never build one from `HEAD~1`.
- Do not hand reviewers open-ended directives ("check every caller") without a task-specific reason, and do not ask them to re-run tests the report already proves.
- Do not pre-judge findings. Phrases banned from reviewer prompts: "the plan chose", "do not flag", "at most Minor", and "don't treat X as a defect". Suspect a false positive? Let the reviewer report it anyway, and adjudicate it inside the fix loop.
- Do not ignore an escalation, and do not retry the same model unchanged.
- A plan mandate is no reason to dismiss a finding. A fix that goes against the plan needs a ledgered ruling first.
- Do not fix findings in the controller session.
- Do not adjudicate before round 5. Do not discard anything silently.
- Do not advance while a Critical or Important finding is neither fixed nor parked with a ruling.
- Do not launch a second fix wave after the final review.
- Do not poll a wait interface on short timeouts; do not wait in silence with no time limit.
- Do not work around a hook denial.

## Output and handoff
- Workspace `.ai-sdlc/sdd/<slug>/`: `ledger.md`, `plan-path`, `task-N-brief.md`, `task-N-report.md`, `review-<base7>..<head7>.diff`.
- plan.md (or the bounded `## Plan`) with ticked steps; the ledger lines above.
- A progress.md Log entry and updated `next`, committed as `sdlc(<slug>): build log`.
- Final message with "Rulings I made".
- Handoffs: `ai-native-sdlc:worktree` at setup, `ai-native-sdlc:review` and `ai-native-sdlc:fix-review` at the end, `ai-native-sdlc:finish` last.
