---
name: lesson
description: Use when an incident, an escaped bug or a post-mortem needs writing up, or when a fix for a production problem has shipped and the loop must be closed with a regression guard
---

# Writing a lesson

Turn one incident into a blameless, evidence-backed lesson that ends in a regression guard. The template is `<plugin root>/templates/lesson.md`; lessons live in `sdlc/lessons/`.

## When to use
- An incident, an escaped bug or a post-mortem needs to be written up.
- A production fix has shipped and the loop is not yet closed with a guard.

## Steps
1. **Look for the same kind of incident** in `sdlc/lessons/` first. A repeat is the signal for step 7.
2. **Collect the facts:** what happened, when, who was affected, and verifiable evidence (logs, metrics, links, commands). If something is missing, ask the reporter; do not guess.
3. **Find the root cause.** If it is not clear, use `ai-native-sdlc:debug` first. Record the cause, not the symptom.
4. **Write `sdlc/lessons/<YYYY-MM-DD>-<slug>.md`** from `<plugin root>/templates/lesson.md` (English headings, Vietnamese content), with Severity and Owner filled in.
5. **Fix.**
   - Small and clear: fix it now (bounded) and note the commit under `## Fix`.
   - Larger: start `ai-native-sdlc:intent` with `Source: incident <lesson file>` and put the change path in `Follow-up change:`.
6. **Regression guard.**
   - A code defect: a test that fails first, via `ai-native-sdlc:tdd`.
   - The agent behaved wrongly: `ai-native-sdlc:eval` with `source: incident` and `lesson` pointing back to this file.
   - Write the path under `## Regression guard`.
7. **If the agent made the same kind of mistake a second time** (step 1, `review.md`, the Log), use `ai-native-sdlc:agents-md`. Record the line added under `## AGENTS.md update`, or write "không cần".
8. **Commit** as `lesson(<slug>): add`. If inside a change, add one line to its Log.

## Rules
- Blameless: no blaming individuals.
- Evidence must be verifiable.
- Remove secrets and customer data.
- One lesson per incident.
- Do not close a lesson without a regression guard, unless the owner approves the reason it cannot be done (recorded in that section).
- Lessons are append-only: new information goes in a `## Update <YYYY-MM-DD>` section.

## Output and handoff
The lesson file and one commit. The next skill is `ai-native-sdlc:intent` (follow-up change), `ai-native-sdlc:tdd` or `ai-native-sdlc:eval` (guard).
