---
description: Forget a Bettyjane human pin by its coin id (txid:vout)
allowed-tools: Bash(bun bin/bj.ts unpin:*)
---

Unpin (forget) the Bettyjane pin named by the coin id below, signed with the
human key, then report the spend txid. The id is a coin id like `txid:1`.

Run the bj CLI from the Bettyjane project root with the Bash tool:

`bun bin/bj.ts unpin "<the coin id below>"`

(If the current directory is not the Bettyjane repo because the plugin is
installed elsewhere, run the same command against `$CLAUDE_PLUGIN_ROOT/bin/bj.ts`
instead.)

Pin id to unpin: $ARGUMENTS
