---
description: Remember a private (encrypted) note to Bettyjane memory, readable only with the key
allowed-tools: Bash(bun bin/bj.ts private:*)
---

Remember the note below as a **private** Bettyjane memory: it is encrypted to the
agent's own key (ECIES) and only the ciphertext goes on chain, so the public
record is unreadable without the key. Report the resulting txid.

Run the bj CLI from the Bettyjane project root with the Bash tool:

`bun bin/bj.ts private "<the note below>"`

(If the current directory is not the Bettyjane repo because the plugin is
installed elsewhere, run the same command against `$CLAUDE_PLUGIN_ROOT/bin/bj.ts`
instead.) Use this for sensitive-but-valuable context. Never put raw secrets
(keys, tokens, mnemonics) on chain even encrypted.

Note to remember privately: $ARGUMENTS
