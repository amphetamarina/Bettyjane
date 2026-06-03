---
description: Tidy Bettyjane memory by forgetting near-duplicate agent memories
allowed-tools: Bash(bun bin/bj.ts consolidate:*)
---

Tidy the agent's live memory: group memories by similarity and forget the
near-duplicates, keeping one coin per cluster. This is the manual equivalent of
the old SessionEnd hook; run it when the working set has accumulated reworded
repeats.

Run the bj CLI from the Bettyjane project root with the Bash tool:

`bun bin/bj.ts consolidate`

(If the current directory is not the Bettyjane repo because the plugin is
installed elsewhere, run the same command against `$CLAUDE_PLUGIN_ROOT/bin/bj.ts`
instead.) Forgetting sweeps the dust back to the agent, so this also recycles
funding. Report what was forgotten.
