---
description: Forget a Bettyjane human pin by its coin id (txid:vout)
allowed-tools: Bash(bun:*)
---

Unpin (forget) the Bettyjane pin named by the coin id below, signed with the
human key, and report the spend txid. The id is a coin id like `txid:1`.

Pin id to unpin: $ARGUMENTS

!`bun "${CLAUDE_PLUGIN_ROOT:-$CLAUDE_PROJECT_DIR}/bin/bj.ts" unpin "$ARGUMENTS"`
