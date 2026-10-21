---
name: claude-md
description: Alias of agents-md. Use only when the user explicitly asks to update or edit CLAUDE.md; the real work is done by the agents-md skill
---

# Alias of agents-md

`CLAUDE.md` now only imports `AGENTS.md`, which is the root instruction file for every agent. Use the `agents-md` skill (`ai-native-sdlc:agents-md`) and do the work there; do not edit `CLAUDE.md` beyond the `@AGENTS.md` line.
