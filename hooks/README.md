# Claude Code hooks

Drive Bettyjane straight from Claude Code, with no custom runner — the hooks
*are* the runner. Watch a session wake up knowing the team's memory, watch new
memories land on chain as it works, and watch the pile get tidied when it ends.

- **`load.ts`** — runs on **SessionStart**. Reads the live coins (the human's
  durable pins and the agent's working memories) and prints them, so Claude
  starts the session with the team's memory in context. Read-only.
- **`capture.ts`** — runs on **Stop** and **StopFailure** (turn end, including
  dead ends). Renders the latest turn and hands it to a backgrounded worker that
  distils it with a model and mints what is worth keeping. The model call takes
  seconds, so it runs detached — the hook returns immediately and never blocks
  the end of a turn. **Opt-in.**
- **`distill-worker.ts`** — the backgrounded half of capture. Asks the distiller
  what to remember and mints each note as an agent memory coin. Fails closed: if
  the distiller is unavailable it mints nothing rather than a weak memory.
- **`distiller.ts`** — turns one rendered turn into notes by asking a model. By
  default it calls the **`claude` CLI** (`claude -p`) for a schema-validated
  `{remember, forgetIds}` block, reusing your existing Claude Code auth (no API
  key, no extra billing) and running the child with a replacement system prompt
  and only user settings, so it stays cheap and the project's own Stop hook never
  fires inside it (capture can't recurse). Set **`BJ_DISTILL_CMD`** to use any
  other headless model CLI instead — the prompt is piped on stdin and notes are
  read from stdout, parsed leniently:

  ```bash
  export BJ_DISTILL_CMD="opencode run"   # or "codex exec", "grok", "hermes", ...
  ```
- **`consolidate.ts`** — runs on **SessionEnd** (session close). Tidies the pile
  that `capture.ts` laid down: embeds each live memory and forgets
  near-duplicates grouped by similarity (so reworded repeats collapse, not just
  exact matches), keeping one coin per cluster. Forgetting sweeps the dust back,
  so this also recycles funding. **Opt-in** (same `BJ_CAPTURE` gate).
- **`distill.ts`** — the pure turn-rendering and reply-parsing logic
  (unit-tested). Similarity grouping lives in `src/domain/consolidate.ts`.

Capture is **remember-only** for now: the model writes new memories but never
drops existing ones (`forgetIds` is always empty). Merging and dropping stale
memories is the SessionEnd job. It needs the `claude` CLI on `PATH`; without it,
capture mints nothing and logs to `hooks/.capture.log`.

The wiring lives in [`.claude/settings.json`](../.claude/settings.json) for local
development, and in [`hooks/hooks.json`](hooks.json) when the repo is installed as
a Claude Code plugin (see [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json)),
which also ships the `/pin` and `/unpin` commands. Claude Code asks you to approve
project hooks the first time it sees them.

## ⚠️ On mainnet, memories are real, public, and permanent

With `BJ_NETWORK=mainnet`, every captured memory:

- spends real XEC (a dust coin plus a network fee per memory),
- is written to the public eCash chain and **cannot be deleted** — `forget` only
  removes it from the *live* set; the text stays in history forever.

So `capture.ts` only writes when you explicitly opt in, and a model decides what
is worth keeping from each turn — its notes are minted verbatim and permanently,
so treat the whole turn as publishable. Use `regtest` or `testnet` if you just
want to try the flow.

## Setup

Export your wallet so the hooks can read and sign:

```bash
export BJ_MNEMONIC="your twelve word phrase ..."   # the team wallet
export BJ_NETWORK=mainnet                           # or testnet / regtest
# export BJ_PASSPHRASE=...                           # optional

# Capture is off until you opt in. Leave it unset to keep load read-only.
export BJ_CAPTURE=1                                  # enable writing memories
```

Without `BJ_MNEMONIC` both hooks are silent no-ops, so the repo is safe to open
without any wallet configured.

## Fund the agent

`capture.ts` signs with the **agent** key, so that address needs XEC. Start a
session — `load.ts` prints the agent address — and send it a small amount
(enough for several dust coins plus fees). Forgetting a memory sweeps its value
back, so the balance recycles apart from fees.

## Watch it

1. `export BJ_MNEMONIC=... BJ_NETWORK=mainnet` (omit `BJ_CAPTURE` for now).
2. Start `claude` in this repo and approve the hooks. The SessionStart context
   shows the current pins/memories and the agent address.
3. Fund the agent address.
4. `export BJ_CAPTURE=1` and restart the session. After each turn, `capture.ts`
   prints `bettyjane: remembered "..." -> <txid>` on stderr.
5. Confirm on chain: `bun bin/bj.ts inspect <txid>` (add `--network testnet` off
   mainnet), or open the txid in an eCash explorer. Start a fresh session and
   watch the new memory appear in the loaded context.
