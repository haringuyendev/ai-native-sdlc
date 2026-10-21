---
name: status
description: Use when the user asks to see the SDLC status board or which changes are open, blocked or stale, or runs /ai-native-sdlc:status - shows the open changes in the current repo
---

# Showing the status board

Print the table of open changes in the current repo and point the user at what needs attention. It changes no file.

## Steps
1. **Run the board.** From the repo root, run `node <plugin root>/scripts/sdlc-status.mjs`. It prints a Markdown table of open changes (Change, Stage, Owner, Tasks, Next, Blocked, Cập nhật), or a line saying there are none. If it prints nothing, the repo has no `sdlc/config.json`: say so and offer `ai-native-sdlc:init`.
2. **Show the table** to the user as printed.
3. **Point at what needs attention.** Name first the changes with a value in the Blocked column, then those whose Cập nhật date is old. For each, suggest `ai-native-sdlc:resume <change>` to continue it.

## Rules
- Read only: never edit `progress.md` or any other file here.
- Do not rebuild the table from the `<sdlc-status>` block in the session context; it may be stale. Run the script.
