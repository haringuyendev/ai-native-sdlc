# Re-Review Prompt (one fix round)

Template for the check that follows each fix round. It is narrow on
purpose: the full review is already done, so this pass only settles the
open findings and looks for harm done by the fix.

```
Subagent:
  description: "Re-review Task N fix round R"
  model: [MODEL — REQUIRED: choose per SKILL.md Model Selection; an omitted
         model silently inherits the session's most expensive one]
  prompt: |
    Two questions, nothing more:
    1. Is each finding below really gone?
    2. Did the fix itself break anything?

    ## Findings to Verify

    [FINDINGS]

    ## Material

    - **Fix base:** [FIX_BASE_SHA] (the commit the last review ended on)
    - Current head: [HEAD_SHA]
    - Package for the fix range: [DIFF_FILE]
    - Brief for the task: [BRIEF_FILE]
    - Implementer report, fix sections appended last: [REPORT_FILE]

    The package holds the fix commits, a stat and the fix diff with
    context; one read covers it and git stays closed. Should the package
    be missing, run `git diff [FIX_BASE_SHA]..[HEAD_SHA] --stat`, followed
    by `git diff [FIX_BASE_SHA]..[HEAD_SHA]`, instead.

    ## Limits

    - **Scope:** the findings list and the fix diff, nothing else.
    - **Untouched code:** not re-reviewed. Anything you notice there goes
      to Out-of-Scope Observations; it never blocks the task and never
      adds a round. The whole-branch review comes after the last task.
    - **Checkout:** read-only. Working tree, index, HEAD and branches stay
      as they are.
    - **Help:** none. You are the only re-reviewer; a helper or a second
      opinion would just repeat this seat. Split a big diff into passes
      and say so. Do not dispatch subagents or a second reviewer.
    - **Tests:** the fix section must name the covering tests and show
      their output. Check those claims against the diff rather than
      rerunning the suite; a single focused test only for a concrete
      doubt that no logged run settles.

    ## Output Format

    Start with the first finding's verdict. Lines carry verdicts, findings
    with file:line, or checks you ran; no introduction or narration.

    ### Finding Verdicts

    Keep the order of Findings to Verify:
    - **[finding one-liner]** — ADDRESSED | NOT ADDRESSED, plus
      file:line proof. Effort is not a fix: ADDRESSED only when that exact
      defect has disappeared.

    ### New Breakage in the Fix Diff

    Damage the fix caused or introduced, each with file:line and a level
    (Critical, Important, Minor). "None" when clean.

    ### Out-of-Scope Observations

    Things seen outside the fix diff. They block nothing; the controller
    records them in the ledger for the final review. "None" when empty.

    ### Verdict

    **Fix round:** [All findings addressed, no new Critical/Important
    breakage | Findings remain open] — then list whichever remain open.
```

**Filling the fields**

- `[MODEL]`, required: per SKILL.md Model Selection. A small fix diff
  warrants a cheap-to-mid tier.
- `[BRIEF_FILE]`: the brief the implementer used.
- `[FINDINGS]`: the prior review's Critical and Important findings and
  spec gaps, verbatim, one bullet each.
- `[REPORT_FILE]`: the implementer's report, fix sections included.
- `[FIX_BASE_SHA]`: the commit the last review ended on.
- `[HEAD_SHA]`: the current commit.
- `[DIFF_FILE]`: the path printed by
  `bash scripts/review-package PLAN_FILE FIX_BASE HEAD`.

**Returned:** ADDRESSED or NOT ADDRESSED per finding, any breakage from
the fix, out-of-scope observations, and a verdict on the round.
