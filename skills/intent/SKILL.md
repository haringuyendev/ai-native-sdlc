---
name: intent
description: Use when someone brings a new idea, ticket, request or incident that should become tracked work and no sdlc/changes folder exists for it yet - surveys the current system, asks the originator only what is still unclear, and writes intent.md and progress.md
---

# Capturing intent

Turn a raw idea, ticket or incident into an accepted `intent.md`: the *what* and *why* of a change, in the originator's words. Templates live in `<plugin root>/templates/`.

## When to use
- Someone brings a new idea, ticket, request or incident that should become tracked work.
- No `sdlc/changes/<date>-<slug>/` folder exists for it yet.
- Not for continuing an existing change (read its `progress.md` instead) and not for a spike (see step 3).

## Steps
1. **Check the harness.** Confirm `sdlc/config.json` exists. If it does not, hand off to `ai-native-sdlc:init` and stop.
2. **Check for duplicates.** Look in the `<sdlc-status>` block for an open change that covers the same ground. If one does and the user has not already said which they want, ask whether to continue that change or create a new one.
3. **Triage.** If the work is a *spike* (a throwaway experiment, or a small and obvious task), create no folder: say so in one line and do the work. Otherwise continue to step 4.
4. **Survey the current system before asking anything.** Read-only, no permission needed. Find what already exists for this request: code, endpoints, tables and screens in the affected repos (use the code index or search the repo's `AGENTS.md` prescribes), open and closed changes under `sdlc/changes/`, `sdlc/lessons/`, and the ticket if one is named and readable. Come away knowing what already exists, what is partly there, what is missing, and what contradicts the request. Keep it proportionate: a few targeted lookups, not a full audit. If the request names no system you can locate, say so in one line and move on.
5. **Fill what you already know, ask only the gaps.** Draft every field below from the request, the conversation so far, the ticket and the survey:
   - **Problem**: who is struggling with what today; use numbers if they have them.
   - **Proposed outcome**: what is different once this is done; the success criteria.
   - **Affected users and systems**.
   - **Current system**: what the survey found exists, is partial or is missing (facts, with file or change references).
   - **Constraints**: security, personal data, performance, deadline, technology.
   - **Open questions**.
   - **Source**: `idea` | `ticket <ID>` | `incident <lesson file>`.

   Then sort each field:

   | Pile | How to recognize it | What you do |
   |------|---------------------|-------------|
   | **Settled** | the user said it, or the survey verified it | write it in; do not ask again |
   | **Safe guess** | inferable, and a wrong guess is cheap to fix at the review in step 8 | write it in, marked as an assumption |
   | **Ask** | it changes what the change is, and you are confused, the sources conflict, or you could not verify it | ask |

   If the Ask pile is empty, skip the interview and go straight to step 6; the review in step 8 is the confirmation. Otherwise ask one question per message, most important first, each tied to what you found ("The order screen already has a cancel button that only works before payment; is the problem cancelling after payment?"). Never ask about something the user already told you or the survey already answered, and never walk through the fields as a checklist.
6. **Name the change.** Pick a short kebab-case slug and create `sdlc/changes/<YYYY-MM-DD>-<slug>/`, using today's date.
7. **Write the files.** Write `intent.md` from `<plugin root>/templates/intent.md`: the first line records Author, `Status: draft` and Source. Write `progress.md` from `<plugin root>/templates/progress.md` with the fields `change`, `title`, `owner`, `stage: intent` and `next`.
8. **Review with the originator.** Show `intent.md`, list the assumptions you made so they know what to check, and revise it from their feedback until they approve it explicitly.
9. **Accept.** Once approved: change the line to `Status: accepted (<name>, <date>)`, set `approvals.intent: { by: <name>, at: <YYYY-MM-DD> }`, set `stage: spec` and `next: ai-native-sdlc:spec → spec.md`, add a Log entry (`### <YYYY-MM-DD> — <name> + <agent>` (agent name from your session context) under `## Log`), then commit both files as `sdlc(<slug>): intent accepted`.

## Rules
- The intent says *what* and *why*, never *how*.
- Use the originator's own words; mark anything you inferred as an assumption.
- Every question must earn its place: it changes the change and neither the conversation nor the system answers it. Information already given is never asked for again, not even to "confirm"; confirmation happens once, on the written draft.
- Keep "verified in the system" separate from "assumed". Survey findings go under Current system and Affected users and systems, never as a design.
- Never invent numbers or metrics.
- Never write `accepted` before explicit approval ("sounds good" to an idea that is not written down does not count).
- Never create a folder for a spike.
- Never write a spec or a plan in this skill.

## Output and handoff
`intent.md`, `progress.md` and one commit. Then hand off to `ai-native-sdlc:spec`.
