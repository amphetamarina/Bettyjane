---
description: Load the team's current Bettyjane memory (pins + working set) into context
allowed-tools: Bash(bun bin/bj.ts load:*)
---

Read the team's current Bettyjane memory, the human's durable pins and a small
working set of the agent's memories, and bring it into context so you start the
session knowing what the team remembers.

Run the bj CLI from the Bettyjane project root with the Bash tool:

`bun bin/bj.ts load`

(If the current directory is not the Bettyjane repo because the plugin is
installed elsewhere, run the same command against `$CLAUDE_PLUGIN_ROOT/bin/bj.ts`
instead.) Read-only. Add `--namespace <name>` to load a specific namespace. Treat
the printed pins as standing instructions.
