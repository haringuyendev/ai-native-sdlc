---
name: intent
description: Use when someone brings a new idea, ticket, request or incident that should become tracked work and no sdlc/changes folder exists for it yet - interviews the originator and writes intent.md and progress.md
---

# Capturing intent

Turn a raw idea, ticket or incident into an accepted `intent.md`: the *what* and *why* of a change, in the originator's words. Templates live in `<plugin root>/templates/`.

## When to use
- Someone brings a new idea, ticket, request or incident that should become tracked work.
- No `sdlc/changes/<date>-<slug>/` folder exists for it yet.
- Not for continuing an existing change (read its `progress.md` instead) and not for a spike (see step 3).

## Steps
1. **Check the harness.** Confirm `sdlc/config.json` exists. If it does not, hand off to `ai-native-sdlc:init` and stop.
2. **Check for duplicates.** Look in the `<sdlc-status>` block for an open change that covers the same ground. If one does, ask the user whether to continue that change or create a new one.
3. **Triage.** If the work is a *spike* (a throwaway experiment, or a small and obvious task), create no folder: say so in one line and do the work. Otherwise keep interviewing.
4. **Interview the originator.** Send exactly one question per message, preferring open questions anchored in a concrete situation ("Tell me about the last time this happened"). Cover:
   - **Problem**: who is struggling with what today; use numbers if they have them.
   - **Proposed outcome**: what is different once this is done; the success criteria.
   - **Affected users and systems**.
   - **Constraints**: security, personal data, performance, deadline, technology.
   - **Open questions**.
   - **Source**: `idea` | `ticket <ID>` | `incident <lesson file>`.
5. **Name the change.** Pick a short kebab-case slug and create `sdlc/changes/<YYYY-MM-DD>-<slug>/`, using today's date.
6. **Write the files.** Write `intent.md` from `<plugin root>/templates/intent.md`: the first line records Author, `Status: draft` and Source. Write `progress.md` from `<plugin root>/templates/progress.md` with the fields `change`, `title`, `owner`, `stage: intent` and `next`.
7. **Review with the originator.** Show `intent.md` and revise it from their feedback until they approve it explicitly.
8. **Accept.** Once approved: change the line to `Status: accepted (<name>, <date>)`, set `approvals.intent: { by: <name>, at: <YYYY-MM-DD> }`, set `stage: spec` and `next: ai-native-sdlc:spec → spec.md`, add a Log entry (`### <YYYY-MM-DD> — <name> + <agent>` (agent name from your session context) under `## Log`), then commit both files as `sdlc(<slug>): intent accepted`.

## Rules
- The intent says *what* and *why*, never *how*.
- Use the originator's own words; mark anything you inferred as an assumption.
- Never invent numbers or metrics.
- Never write `accepted` before explicit approval ("sounds good" to an idea that is not written down does not count).
- Never create a folder for a spike.
- Never write a spec or a plan in this skill.

## Output and handoff
`intent.md`, `progress.md` and one commit. Then hand off to `ai-native-sdlc:spec`.
