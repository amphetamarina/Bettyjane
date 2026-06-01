# Claude Code hooks

Drive Bettyjane straight from Claude Code, with no custom runner — the hooks
*are* the runner. Watch a session wake up knowing the team's memory, and watch
new memories land on chain as it works.

- **`load.ts`** — runs on **SessionStart**. Reads the live coins (the human's
  durable pins and the agent's working memories) and prints them, so Claude
  starts the session with the team's memory in context. Read-only.
- **`capture.ts`** — runs on **Stop** and **StopFailure** (turn end, including
  dead ends). Distills the last thing you asked into one line and mints it as an
  agent memory coin. Harness-injected content (skill banners, image notes) wears
  the user role but is ignored, so only what you actually typed is captured.
  **Opt-in.**
- **`distill.ts`** — the pure turn → one-line-memory logic (unit-tested).

The wiring lives in [`.claude/settings.json`](../.claude/settings.json). Claude
Code asks you to approve project hooks the first time it sees them.

## ⚠️ On mainnet, memories are real, public, and permanent

With `BJ_NETWORK=mainnet`, every captured memory:

- spends real XEC (a dust coin plus a network fee per memory),
- is written to the public eCash chain and **cannot be deleted** — `forget` only
  removes it from the *live* set; the text stays in history forever.

So `capture.ts` only writes when you explicitly opt in, and it distills the
**last thing you asked** (its first line) — make sure that is safe to publish.
Use `regtest` or `testnet` if you just want to try the flow.

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
