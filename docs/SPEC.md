# Bettyjane — specification

Persistent, public, tamper-evident memory for a human-plus-agent team, stored on
eCash (XEC). Every memory is a coin. This document describes the system as built
in v0.1.0: the coin format, the two-key model, how memory is captured and tidied,
how a small working set is chosen each turn, the integration API, and the tools
around it (CLI, plugin, explorer). It is written to be understood and run.

---

## The one idea

An LLM has amnesia. Claude, GPT, any of them forget everything the moment a call
ends. They are brilliant and they wake up with a blank mind every single time.

So we give the team a notebook, except the notebook is made of coins. Each memory
is a tiny coin sitting on the eCash chain. The agent's mind, right now, is the
handful of coins it currently holds. To forget something, it spends that coin and
the coin leaves the table. The spending is recorded forever, so nothing is truly
destroyed — it is just no longer in hand.

The agent is not a program running on the blockchain. The agent is the set of
coins it holds and the trail of how that set changed. Its identity and memory
are the chain. Its thinking happens elsewhere.

---

## The three pieces

Think of an old game console.

1. **The notebook — coins on the eCash chain.** The save file: the team's current
   memories and the full history of every change. The chain keeps it safe and
   ordered. This repository is that layer.

2. **The brain — an LLM.** The console that plays. Claude Code, the Claude API,
   any agent framework. It has no memory of its own. You hand it the current
   coins as text, it thinks, it tells you what to remember and what to forget.

3. **The runner — whatever advances a turn.** Your own loop, or, with Claude
   Code, hook scripts that fire on their own. Without it the coins just sit there
   between turns.

The brain and the runner live outside this repository. The library gives them
the notebook and the four verbs to write in it.

---

## What is in the notebook

**Each memory is a coin.** A memory is a dust coin — exactly `DUST_SATS` (546
sats) — sitting at an address, with its text attached in the transaction's
`OP_RETURN` when it was minted. The unspent coins at an address are its current
memory. You read them in one call: list the live coins at that address
(`MemoReader.listLiveCoins`).

**Forgetting is spending.** To drop a memory, spend its coin. The dust returns to
the wallet, the coin disappears from the live set, and the act of spending stays
in history. So "what do I remember now" is the live set, and "what did I once
know" is the full chain.

> Analogy: the agent's mind is a small pile of coins on a table. Remembering lays
> a new coin down. Forgetting picks one up and pockets it. A photo of the table
> is taken at every change, so you can always see what it held last week.

**The live set is the pool; the working set is smaller.** The live coins are
already curated, because the junk was spent. But you do not pour all of them into
a prompt — long context makes the brain worse and costs more. Each turn the brain
sees a small working set: the human's pins, plus the few live coins most relevant
right now, picked by an off-chain search index. The size is a knob
(`DEFAULT_MAX_WORKING`, 24), set by what the model uses well, not by any chain
limit.

### The coin format

Each write is one transaction with the memo in `OP_RETURN` (output 0) and the
dust memo coin (output 1):

- **LOKAD id** `BJNE` then a version byte identify a Bettyjane memo, so unrelated
  dust at the same address is ignored.
- **kind** is `pin` (durable, human) or `memory` (working, agent).
- **content** is inline `text`, a `pointer` for content too large for one coin,
  or `encrypted` ciphertext (see below).
- **version** is `1` (unsigned) or `2` (the memo carries a recoverable ECDSA
  signature over its content, so authorship is provable from the coin alone).

**Large content uses a pointer chain.** A note longer than one `OP_RETURN` is
written as a run of data-only chunk transactions (≤211 bytes each, up to 6
chunks, `MAX_MEMORY_BYTES` ≈ 1266 bytes); the memory coin then carries a
`pointer` whose payload is the chunk transaction ids in order.
`MemoReader.resolveText` fetches the chunks and reassembles the original note.
The coin stays tiny and the content can be larger. Full detail is in
[coin-format.md](coin-format.md).

**Extensions on the format.** Four capabilities layer on top, each backward
compatible with v1 coins (full detail in [coin-format.md](coin-format.md)):

- **Author signatures (v2, AMP-239).** A 65-byte recoverable ECDSA signature over
  `sha256(LOKAD ‖ header ‖ payload)`; the verifier recovers the signer and matches
  it to the coin's address. The reader exposes `authorVerified`.
- **Namespaces (AMP-243).** A namespace is the BIP-44 address index, partitioning
  an author's memory into separate watchable addresses; the default namespace is
  the original address.
- **eMPP batching (AMP-240).** Several memos ride in one `OP_RETURN` as eMPP
  sections with one dust coin each, so a turn's notes can share a transaction while
  each note stays independently forgettable.
- **Encrypted memories (AMP-242).** An `encrypted` content type carries an ECIES
  blob (secp256k1 ECDH + AES-256-GCM), readable only with the key; minted opt-in
  via `rememberPrivate`, shown as `[encrypted]` without the key.

---

## Two pens: the human and the agent

The notebook has two authors, and that is a small change, because writing a coin
is the only mechanism either pen needs.

**Two keys, two piles.** The agent's memory coins live at one address, controlled
by the agent's key. The human's pins live at a second address, controlled by the
human's key. One BIP-39 mnemonic derives both as separate BIP-44 accounts under
XEC (coin type 1899): the agent at `m/44'/1899'/0'/0/0`, the human at
`m/44'/1899'/1'/0/0`. Both sit on the same chain, and every coin carries the
signature of whoever minted it, so you always know who wrote what. See
[keys-and-addresses.md](keys-and-addresses.md).

**Two roles, on purpose.** The agent keeps fast, churning working memories. The
human pins rare, durable things: corrections, standing instructions, facts the
agent keeps getting wrong.

**The signature is the permission.** Because pins live at the human's address,
the agent's key cannot spend them — `forget`/`unpin` only ever consider coins at
the signer's own address, so the agent can read a pin and obey it but cannot
erase it. There is no separate access-control system to build.

> Analogy: the agent's coins churn on the table. The human's coins are glued to
> the corner. The agent reads all of them and only ever pockets its own.

**Four verbs, split by key:**

- Agent: `remember(note)` mints a memory coin, `forget(id)` spends one.
- Human: `pin(note)` mints a pin coin, `unpin(id)` spends one.

All four are methods on `Minter`, each taking the appropriate signer.

---

## Retrieval and the working set

The live coins are the pool; a small, relevant subset is fed to the brain each
turn.

- An **off-chain embedding index** keys a vector by each coin id
  (`EmbeddingIndex`). It is a cache, not the truth: `buildIndex` rebuilds it from
  the chain at any time, so losing it costs nothing permanent.
- A dependency-free **`HashEmbedder`** (hashing bag-of-words, FNV-1a, L2
  normalized) provides vectors with no external service or key. Any `Embedder`
  can be swapped in.
- **`retrieveRelevant(items, k, query?)`** returns the top-K live coins, capped
  by `DEFAULT_MAX_WORKING`. With a query it ranks by similarity; without one it
  returns the most recent.

---

## Capture and consolidation

Memory changes through two moments: capture (per turn) and consolidation (at
session end).

- **Capture** looks at the latest turn only and writes a small delta — usually
  nothing. Most turns produce no durable fact, so most turns mint no coin.
  Capturing per turn means a crash loses at most one turn, which is what makes a
  disposable runner safe.
- **Consolidation** tidies the pile: `planConsolidation` groups live memories by
  semantic similarity (cosine ≥ 0.9) and drops near-duplicates, so the live set
  stays lean without summarizing away anything still distinct.

A note on cadence: on XEC a write is sub-cent and final in seconds, so cost is
not the reason to wait. The reason is noise — a memory written after every reply
captures half-finished thoughts and duplicates, and a live set full of that makes
retrieval worse. So capture writes a distilled delta per turn while consolidation
merges at the end. **Capture, then tidy.**

> Known limitation: today's capture is closer to a verbatim delta than a distilled
> fact, so consolidation does much of the culling. Turning capture into genuinely
> distilled facts (and merging by LLM summary, not just dropping duplicates) is
> the next step.

---

## The integration API

The whole connection any brain needs is two functions, in
[`src/application/memory.ts`](../src/application/memory.ts):

```
loadMemory()                  -> read the chain: the human's pins plus the top-K
                                 live coins, as text for a prompt.
saveMemory(remember, forget)  -> mint the new notes and spend the forgotten ids.
```

For a raw model API, put the loaded text in the system prompt and ask the model
to end its reply with a small JSON block of memory operations, then call
`saveMemory`. The brain is interchangeable; swap Claude for anything and the
coins do not change.

---

## Running it from any agent harness

The runner — whatever advances a turn — drives Bettyjane through the **`bj` CLI**,
so the same three moves work under Claude Code, Codex, opencode, a shell loop, or
anything that can run a command. No harness-specific hooks:

- **Before a turn → `bj load`.** Reads the pins and the working set from the chain
  via `loadMemory` and prints them; that text becomes the agent's context. The
  agent wakes up already knowing.
- **After a turn → `bj capture`.** Distills the turn (piped on stdin, or rendered
  from a `--transcript`) and writes a coin per note worth keeping. Distillation
  runs through `BJ_DISTILL_CMD` (any model CLI) or the bundled `claude`.
- **At session end → `bj consolidate`.** Merges near-duplicate coins and drops the
  stale via `planConsolidation`.

`remember` / `forget` / `private` / `consensus` / `pin` / `unpin` are the explicit
verbs; the wallet comes from `BJ_MNEMONIC` / `BJ_NETWORK`. On **Claude Code** the
repo also installs as a plugin that exposes every verb as a skill (`/remember`,
`/capture`, `/pin`, …), so the agent can be asked to remember or load directly.
See [AGENTS.md](../AGENTS.md) for the runner loop and
[docs/coin-format.md](coin-format.md) for the mainnet "real, public, and
permanent" warning.

---

## Tools

- **`bj` CLI** ([`bin/bj.ts`](../bin/bj.ts)): `inspect <txid>` decodes the memo in
  any transaction; `pin` / `unpin` are the human verbs signed with the human key;
  `init` shows both addresses, their funding, and the live memory, and can mint
  initial pins.
- **Web explorer** ([`explorer/`](../explorer)): a read-only page that shows the
  live pins and memories at the agent and human addresses side by side, polling
  the chain. Run it locally with `bun run watch`, or deploy it to Vercel
  (`public/` static site plus an `api/` serverless reader).

---

## How the agent is born

You create two things: the agent, and its first pins. Fund the addresses with a
little XEC — enough to mint many coins and pay the tiny fees — then mint a couple
of pins from the human key: the agent's name, its goal, a standing instruction or
two. The moment those transactions finalize, a few seconds later, the agent
exists, holding its first coins, waiting for its first session.

Lighting the pilot light. `bj init` is the glue that does it.

---

## What you give up to keep it simple

- **The search index is off chain.** It is a cache, not the truth. Embed each
  coin's text when you mint it, key the vector by the coin id, and rebuild from
  the chain whenever you want. Losing it costs nothing permanent.
- **The live set is your on-chain footprint.** Every kept memory is a coin in the
  chain's coin set. Spend to forget, both to free the dust and to keep the
  footprint lean. This is fine at artifact scale and antisocial at millions of
  coins.
- **The brain still runs off chain.** The chain is the memory and the referee, not
  the compute.

---

## Why bother (the payoff)

- **The runner is disposable; the agent is not.** Kill the runner, lose the
  laptop — the team's whole memory is on the chain. Point a fresh runner at the
  same addresses and it wakes up exactly where it left off.
- **Its mind is a public query.** Anyone can list the agent's live coins to see
  what it remembers now, and read the chain to see how it got there.
- **One auditable record of who steered and when.** Replay the chain and watch the
  human's pins shape the agent, all signed and timestamped.
- **Nobody can quietly tamper with it.** Every change is a signed transaction.

---

## Future direction

- **Distilled capture.** Make per-turn capture mint distilled facts rather than
  verbatim deltas, and let consolidation merge by LLM summary, not only drop
  duplicates.
- **The quine covenant.** Today you trust your own keys: the agent holds its key,
  the human holds theirs, and self-replication of the identity coin is a rule the
  runner follows. The destination is to wrap the identity coin in a recursive
  covenant so no single mistake can make the agent deviate. The memory model does
  not change, because memory was always just coins owned by the agent's key.

---

## Two tips

**Keep human pins few and durable.** The point of the small working set is that
context cannot grow forever. Pins are a separate layer with the same discipline:
few, durable, retire the stale ones. If the human glues long messages to the
corner, you have rebuilt the unbounded-context problem with two keys and extra
steps.

**Let the chain be the storage room.** When a memory will not fit on one coin, the
pointer chain keeps the coin tiny and puts the bytes in dedicated chunk
transactions. Carry the pointer; read the content back on demand.
