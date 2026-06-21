---
description: Forget a Bettyjane agent memory by its coin id (txid:vout)
allowed-tools: Bash(bun bin/bj.ts forget:*)
---

Forget the agent memory named by the coin id below, spend its coin so it leaves
the live set, then report the spend txid. The chain keeps the history.

Run the bj CLI from the Bettyjane project root with the Bash tool:

`bun bin/bj.ts forget "<the coin id below>"`

(If the current directory is not the Bettyjane repo because the plugin is
installed elsewhere, run the same command against `$CLAUDE_PLUGIN_ROOT/bin/bj.ts`
instead.) Add `--namespace <name>` if the memory lives in a namespace.

Coin id to forget: $ARGUMENTS
