---
description: Distill this turn into durable memories and mint them on chain
allowed-tools: Bash(bun bin/bj.ts capture:*)
---

Capture what was worth remembering from the latest turn: distill it into durable
notes and mint each as an agent memory on chain. This is the manual equivalent of
the old automatic Stop hook.

Run the bj CLI from the Bettyjane project root with the Bash tool, piping the
turn's text (the user's ask plus your response) on stdin:

`echo "<the turn text>" | bun bin/bj.ts capture`

(If the current directory is not the Bettyjane repo because the plugin is
installed elsewhere, run the same command against `$CLAUDE_PLUGIN_ROOT/bin/bj.ts`
instead.) Distillation uses `$BJ_DISTILL_CMD` (any model CLI) or the bundled
`claude`. Memories are public and permanent — never include secrets. The
distiller may mint nothing if the turn carried nothing worth keeping.
