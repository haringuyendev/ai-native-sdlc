---
name: policy
description: Use when turning an organizational policy or convention (security standard, API design rule, UX or brand rule, compliance requirement) into a skill the agent applies consistently, or when such a policy changes
---

# Writing a policy skill

Turn one organizational policy into a skill that the agent loads and applies the same way every time. The template is `<plugin root>/templates/policy-skill.md`.

## When to use
- A security standard, API design rule, UX or brand rule or compliance requirement is applied unevenly and should become a skill.
- An existing policy skill has to change because its source changed.
- Not for a convention that belongs to one repo only (see step 2).

## Steps
1. **Pick one thing that is applied unevenly.** It must have a **named owner** and a **written source of truth** (a link or a file). If either is missing, stop and ask for it.
2. **Choose where it lives.**
   - A convention that is specific to this repo goes in `AGENTS.md` (see `ai-native-sdlc:agents-md`).
   - Organizational knowledge that must be applied uniformly and has an owner goes in a policy skill.
   - Something that must never be violated gets a policy skill **and** a deterministic layer behind it: a hook (`protected_paths` or `gates` in `sdlc/config.json`), or one pass line in `REVIEW.md` that quotes the policy.
3. **Write the skill.** Create `.agents/skills/policy-<name>/SKILL.md` (the single source, read by Codex and Antigravity) from `<plugin root>/templates/policy-skill.md`.
   - The description lists concrete triggers: creating or editing X, reviewing X, generating Y.
   - Every rule is numbered and can be checked.
   - The Check section names a script or command if one exists.
   - Owner, Source and Version are filled in; Version is the date plus the source commit.
   - Make Claude Code see it too: in the `skills` subfolder of the repo's `.claude` directory (create it if needed), make a symlink named `policy-<name>` pointing to `../../.agents/skills/policy-<name>` (run `ln -s ../../.agents/skills/policy-<name> policy-<name>` from that folder). Claude Code discovers a project skill through this symlink (verified). If symlinks are unavailable (for example on Windows without developer mode), copy the folder instead and refresh the copy whenever the source changes; `.agents/skills/` stays the source.
   - Repos that still keep policy skills only in the `skills` folder of `.claude` should move them to `.agents/skills/policy-*` and symlink back.
4. **Test the trigger.** Phrase one related task three different ways and confirm the skill loads each time. Record the result in the change's Log.
5. **Get the owner's approval.** Then commit as `policy(<name>): add` (or `policy(<name>): update`). `ai-native-sdlc:spec` lists the skill under **Policies applied** on its own.
6. **When the policy changes,** edit the skill, bump Version, get the owner to approve again, and commit as `policy(<name>): update`.

## Rules
- One policy per skill.
- Never add a rule that is not in the source.
- Use the source's own terms.
- A skill is only advice: state which deterministic layer stands behind it, if there is one.
- Never put a secret in a policy skill.

## Output and handoff
The policy skill folder and one commit. If a deterministic layer is needed, show the user the edit to `sdlc/config.json` or `REVIEW.md` and wait for their approval before making it.
