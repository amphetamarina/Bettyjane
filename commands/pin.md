---
description: Mint a durable human pin to Bettyjane memory (signed with the human key)
allowed-tools: Bash(bun:*)
---

Mint the note below as a Bettyjane human **pin** — a durable, human-authored
memory signed with the human key — and report the resulting txid.

Note to pin: $ARGUMENTS

!`bun "${CLAUDE_PLUGIN_ROOT:-$CLAUDE_PROJECT_DIR}/bin/bj.ts" pin "$ARGUMENTS"`
