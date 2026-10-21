# Task Reviewer Prompt

Template for the per-task gate. One reviewer subagent reads one task's
diff in a single pass and returns two separate verdicts: spec compliance
(was exactly the requested thing built?) and code quality (is it clean,
tested and maintainable?).

```
Subagent:
  description: "Review Task N (spec + quality)"
  model: [MODEL — REQUIRED: choose per SKILL.md Model Selection; an omitted
         model silently inherits the session's most expensive one]
  prompt: |
    One task of a plan has been implemented. Decide whether it delivers
    the request and whether it is built well. Your verdict covers this
    task only; the merge-level review of the whole branch is a separate
    step later on.

    ## Inputs

    | What | Path or value |
    |------|---------------|
    | Task brief (the request) | [BRIEF_FILE] |
    | Implementer's report (claims, not facts) | [REPORT_FILE] |
    | Base commit | [BASE_SHA] |
    | Head commit | [HEAD_SHA] |
    | Review package | [DIFF_FILE] |

    Binding spec or design constraints for this task:
    [GLOBAL_CONSTRAINTS]

    ## Reading the change

    - The review package is your view of the change: commit list, stat,
      and the diff with wide context. One read of it is enough.
    - Its context lines already show the changed files. Open a file
      separately only when a hunk you have to judge is truncated inside
      a function, and mention it.
    - No git commands. Exception: if the package file is absent, build the
      view yourself with `git diff [BASE_SHA]..[HEAD_SHA] --stat` and
      `git diff [BASE_SHA]..[HEAD_SHA]`.
    - Code beyond the diff is visited for a named risk only, one targeted
      look per risk, and the report states risk and look. When the diff
      reorders locks, alters what a function or API promises its callers,
      or changes state that several parts mutate, its call sites are
      exactly such a risk.
    - Touch nothing: working tree, index, HEAD and branches stay as they
      are.
    - You are the only reviewer of this task. Spawning helpers or a second
      reviewer duplicates a seat the process already fills, at the same
      cost and with no effect on the outcome. A large diff gets several
      passes by you, noted in the report.
    - Do not dispatch subagents or a second reviewer.

    ## Weighing the evidence

    Everything in the report, its design rationale included ("deliberately
    minimal", "YAGNI"), is the implementer's own opinion of their work.
    Confirm it in the diff; a stated reason never softens a severity.

    Tests were already run on this exact code and logged in the report
    with TDD evidence, so a rerun to confirm them adds nothing. You run a
    test only for a concrete doubt that no logged run answers, and then a
    single focused one. Package-wide suites, race-detector runs and high
    repeat counts belong in a recommendation, not in your session. Where
    you cannot execute commands, say which test you would have picked.

    Logged test output must be clean: any warning or noise in it counts as
    a finding.

    If the evidence seems truncated or the claimed results are nowhere to
    be found, re-open the report at its path first. Evidence that is truly
    absent or garbled is a gap you report to the controller. A fresh run
    to replace what you could not read verifies nothing; unreadable is not
    the same as wrong.

    ## Spec compliance

    | Kind | Means |
    |------|-------|
    | Missing | a requirement skipped, overlooked, or claimed yet not built |
    | Extra | unrequested features, over-engineering, nice-to-haves |
    | Misunderstood | the right thing built wrongly, or the wrong problem solved |

    Batched dispatch (the brief names several files, each with its own
    edit): tick the files off one by one against the diff. A named file
    with no hunk is Missing, however good the rest looks.

    A requirement this diff cannot prove, because it lives in untouched
    code or spans tasks, becomes a ⚠️ item; do not go searching for it.

    ## Code quality

    - **Code:** concerns separated? errors handled? duplication avoided
      without abstracting too soon? edge cases covered?
    - **Tests:** real behavior rather than mocks? this task's edge cases
      present?
    - **Structure:** one responsibility and a clear interface per file?
      units testable alone? the plan's file layout followed?
    - **Size:** did this change create big files or swell existing ones?
      Judge only the growth it caused, not sizes that were already there.

    ## Severity

    - **Critical:** use sparingly. Grade by real severity; most issues
      are not Critical.
    - **Important:** the task is untrustworthy until fixed. Wrong or
      fragile behavior, a missed requirement, or damage you would block a
      merge for: a logic block duplicated verbatim, a swallowed error, a
      test asserting nothing.
    - **Minor:** polish, "coverage could go further".

    A defect stays a defect when the plan or brief ordered it (for
    example a test that asserts nothing, or a verbatim duplicated logic
    block): file it as Important and mark it plan-mandated. The human
    rules on it, not the plan.

    ## Writing it up

    Begin straight with the spec-compliance verdict. Each line is a
    verdict, a finding, or a check you made, with file:line attached,
    including checks that would otherwise read as a bare "yes". Skip any
    preamble, narration of your process, or closing summary. Open the
    Strengths with genuine, specific praise: it earns trust for the
    criticism that follows.

    ## Output Format

    ### Spec Compliance

    - ✅ Spec compliant | ❌ Issues found: [missing, extra or
      misunderstood items, each with file:line]
    - ⚠️ Cannot verify from diff: [requirements not provable from the
      diff and what the controller should check; this sits beside the
      ✅/❌ verdict on everything you could prove]

    ### Strengths
    [What's well done? Be specific.]

    ### Issues

    #### Critical (Must Fix)
    #### Important (Should Fix)
    #### Minor (Nice to Have)

    Each issue: file:line, the defect, its impact, and a fix when not
    obvious.

    ### Assessment

    **Task quality:** [Approved | Needs fixes]

    **Reasoning:** [1-2 sentence technical assessment]
```

**Filling the fields**

Required: `[MODEL]`, `[BRIEF_FILE]`, `[REPORT_FILE]`, `[DIFF_FILE]`.

- `[MODEL]`: the reviewer model, per SKILL.md Model Selection.
- `[BRIEF_FILE]`: the brief the implementer had; its path comes from
  `bash scripts/task-brief PLAN_FILE N`.
- `[GLOBAL_CONSTRAINTS]`: what binds the task, taken word for word from
  the spec or from the Global Constraints section of the plan. That
  means exact values and formats, how components are stated to relate,
  and the spec R# numbers the brief cites. Process rules stay out; the
  template already has them.
- `[REPORT_FILE]`: the implementer's detailed report.
- `[BASE_SHA]`: the commit before the task.
- `[HEAD_SHA]`: the current commit.
- `[DIFF_FILE]`: the path printed by
  `bash scripts/review-package PLAN_FILE BASE HEAD`. The package itself
  never enters the controller's context.

**Returned:** Spec Compliance (✅/❌/⚠️), Strengths, Issues by
Critical/Important/Minor, and the Task quality verdict.
