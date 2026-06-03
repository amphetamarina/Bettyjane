---
description: Mint a 2-of-2 consensus memory neither key can write or forget alone
allowed-tools: Bash(bun bin/bj.ts consensus:*)
---

Mint the note below as a **consensus memory**: it lives at a 2-of-2 P2SH address
and is signed by both the agent and the human key, so it is a shared-truth tier
that neither party can write or forget alone. Report the resulting txid.

Run the bj CLI from the Bettyjane project root with the Bash tool:

`bun bin/bj.ts consensus "<the note below>"`

(If the current directory is not the Bettyjane repo because the plugin is
installed elsewhere, run the same command against `$CLAUDE_PLUGIN_ROOT/bin/bj.ts`
instead.) The 2-of-2 address must be funded first. Use this for facts both
authors have ratified.

Note to ratify: $ARGUMENTS
