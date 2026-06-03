# Bettyjane

**A shared memory for a human and an AI agent, written in coins on a public
blockchain.**

An LLM has amnesia. It forgets everything the moment a reply ends. Bettyjane gives
the team a notebook so it doesn't have to — except the notebook is made of tiny
coins on [eCash](https://e.cash) (XEC), and each coin is one memory.

## The idea in one picture

Picture a pile of coins on a table. That pile is the agent's mind right now.

- **Remembering** lays a new coin on the table (with its text attached).
- **Forgetting** picks a coin up and pockets it.
- A **photo is taken at every change**, so you can always see what the table held
  last week, even after coins are pocketed.

The coins on the table right now are what the team *remembers today*. The album of
photos — the blockchain — is the *full history of how that memory changed*. Read
the memory in one call: list the unspent coins at an address. Nothing lives on
your laptop; if the program crashes, the memory is still on the chain.

## Two pens, one notebook

The notebook has two authors, each with their own key and their own pile of coins:

- **The agent** writes fast, churning **working memories** — what it picked up
  this session.
- **The human** writes rare, durable **pins** — corrections and standing
  instructions the agent must not lose.

Every coin is signed by whoever wrote it, so authorship is always provable. And
because the human's pins live at the human's address, *the agent's key cannot
erase them* — it can read a pin and obey it, never delete it. The signature is the
only permission system there is.

> Four verbs, split by key: the agent does `remember(note)` / `forget(id)`; the
> human does `pin(note)` / `unpin(id)`.

## What this repository is

This is the **memory layer** — the notebook and the pens. It derives the two keys,
watches an address for funding, encodes and decodes the on-chain format, mints and
reads memory coins, picks a small relevant working set each turn, and tidies
duplicates. The **brain** (an LLM) and the **runner** (your loop, or Claude Code's
hooks) live outside it and call in.

The full design — coin format, retrieval, capture/consolidate, the integration
API, the road ahead — is in **[docs/SPEC.md](docs/SPEC.md)**.

## Status

**1.0.0 — feature complete.** The library derives keys and addresses,
observes funding, encodes/decodes the memo format, and mints and reads memory
coins. The four verbs are implemented; notes too large for one coin are split
across a [pointer chain](docs/coin-format.md) and reassembled on read. The
two-function integration API (`loadMemory` / `saveMemory`), an off-chain embedding
index, a dependency-free embedder, and `retrieveRelevant` give a small working set
each turn. Any agent drives it through the **`bj` CLI** — `load`, `capture`,
`consolidate`, `remember`, `forget`, `private`, `consensus`, `pin`, `unpin`,
`inspect`, `init` — so it works across harnesses, not just Claude Code; the repo
also installs as a Claude Code plugin exposing those verbs as skills. A web
explorer shows the live memory. There is no npm package yet — consume it as a
library or plugin from this repo.

Five capabilities layer on the coin format, each backward compatible with
existing coins (see [coin-format.md](docs/coin-format.md); run them with
[`examples/features.ts`](examples/features.ts)):

- **Content-signed memories (v2).** A memo can carry a recoverable ECDSA signature
  over its content, so authorship is provable from the coin alone, not only in its
  spend transaction. The reader and explorer report `authorVerified` per coin.
- **Memory namespaces.** An author's memory can be partitioned into separate,
  independently watchable addresses (one per project/topic) via BIP-44 address
  indices; the default namespace reproduces the original address.
- **eMPP batching.** A turn's notes can ride in one transaction as eMPP sections,
  one dust coin per section, so each note stays independently forgettable.
- **Encrypted private memories.** A note can live on chain as ECIES ciphertext,
  readable only by the holder of the key — opt-in via `rememberPrivate`.
- **2-of-2 consensus memories.** A shared-truth tier neither key can write or
  forget alone: the coin lives at a 2-of-2 P2SH address, so every spend needs both
  signatures.

## Requirements

- [mise](https://mise.jdx.dev) — pins the toolchain (Bun 1.2)

## Quickstart

```bash
mise install        # install the pinned Bun toolchain
mise run install    # install dependencies (bun install)
mise run test       # run the test suite (bun test)
mise run typecheck  # type-check without emitting
```

## Inspector (CLI)

A small `bj` tool for reading what actually landed on chain.

```bash
# See the decoded pin / memory in any tx
bun bin/bj.ts inspect a8ef7cba751f22df120e3e8123cdde103303d567cca1fdb71bb6e07750821af7 --network mainnet

# Machine readable (for scripts / agents)
bun bin/bj.ts inspect <txid> --json
```

It prints the memo coin outpoint (`txid:1`), whether the coin is still live
(unspent), the kind/content, and the raw `OP_RETURN`. `bj init` shows both
addresses, their funding, and the live memory; `bj pin` / `bj unpin` are the human
verbs. Use `--network testnet` for test coins.

## Explorer (web)

A read-only page with two views. **Explore** shows the live memory at one or two
addresses side by side — the human's durable pins and the agent's working
memories — polling the chain so new writes appear without a reload. Signed,
encrypted, and 2-of-2 consensus memories are badged, and a **show forgotten**
toggle reveals the whole album — every memory ever minted, including spent
(forgotten) ones, reconstructed from the address history. **Discover** pools the
whole network: every memory minted under the `BJNE` LOKAD id, across all agents,
each attributed to the address that authored it.

```bash
bun run watch                                   # enter addresses in the page
bun run watch ecash:qq3u… --human ecash:qpry… -n mainnet   # pre-fill them
```

It serves a local page (default `http://localhost:4173`). It is also deployable to
Vercel by importing the repo. See [`explorer/`](explorer).

## Library usage

Lighting the pilot light: derive the wallet, fund the human's pin address, then
mint the first pins from the human key.

```ts
import {
  ChronikGateway,
  Minter,
  Wallet,
  generateMnemonic,
  pin,
  text,
} from "./src/index";

// Create (or recover with an existing phrase) the wallet that holds both keys.
const wallet = Wallet.fromMnemonic(generateMnemonic(), { prefix: "ectest" });
const human = wallet.signer("human");

// Fund this address with testnet XEC out of band, then wait for it to arrive.
console.log("Fund:", human.address);
const chronik = ChronikGateway.fromNetwork("testnet");
await chronik.awaitFunding(human.address, { minimumSats: 10_000n });

// Mint the team's first pins. Each coin is signed by the human key.
const minter = Minter.fromNetwork("testnet");
const results = await minter.mintAll(
  [
    pin(text("name: Bettyjane")),
    pin(text("goal: keep a durable, shared memory")),
    pin(text("standing: cite the eCash upgrade date as 2025-11-15")),
  ],
  human,
);
console.log("Minted:", results.map((r) => r.txid));
```

The public API is re-exported from [`src/index.ts`](src/index.ts).

## Examples and end-to-end tests

The default `mise run test` suite is hermetic — every test runs against fakes and
touches no network. Real on-chain coverage lives separately and runs against
either a private **regtest** node (no faucet, deterministic — what CI uses) or
public **testnet**:

- [`examples/full-loop.ts`](examples/full-loop.ts) — a narrated, runnable loop
  (remember → list → forget). Honors `BJ_NETWORK` / `BJ_CHRONIK_URL`. See
  [`examples/README.md`](examples/README.md).
- [`test/e2e`](test/e2e) — a gated end-to-end suite that asserts the same flow on
  chain. It is skipped unless `BJ_MNEMONIC` is set. The
  [`E2E (regtest)`](.github/workflows/e2e.yml) workflow runs it against a regtest
  node with no faucet; you can also run it locally:

  ```bash
  # testnet (fund the wallet yourself)
  BJ_MNEMONIC="twelve word phrase ..." mise run test-e2e

  # regtest (generate coins locally — see the docs)
  BJ_NETWORK=regtest BJ_CHRONIK_URL=http://127.0.0.1:8331 \
    BJ_MNEMONIC="abandon ... about" mise run test-e2e
  ```

See [docs/testnet-and-e2e.md](docs/testnet-and-e2e.md) for the full funding and CI
story.

## Drive it from any agent (CLI + skills)

Bettyjane's portable interface is the **`bj` CLI** — every capability is a verb,
so any agent runtime (Claude Code, Codex, opencode, Grok, Hermes, or a plain
shell loop) gets persistent on-chain memory by shelling out to it, no
harness-specific hooks required:

```bash
bun bin/bj.ts load                                 # before a turn: load memory
printf '%s' "$turn_text" | bun bin/bj.ts capture   # after a turn: distill + mint
bun bin/bj.ts consolidate                          # at session end: tidy duplicates
```

`load`/`remember`/`forget`/`private`/`consensus`/`pin`/`unpin`/`capture`/`consolidate`
are all CLI verbs (`bun bin/bj.ts --help`). Distillation runs through `BJ_DISTILL_CMD`
(any model CLI — `"opencode run"`, `"codex exec"`, …) or the bundled `claude`. See
[AGENTS.md](AGENTS.md#using-bettyjane-as-memory-from-any-agent-harness) for the
runner loop and [docs/coin-format.md](docs/coin-format.md) for the mainnet "real,
public, and permanent" warning.

### Install as a plugin

The repo ships as a Claude Code plugin — the same verbs exposed as skills
(`/remember`, `/forget`, `/private`, `/consensus`, `/load`, `/capture`,
`/consolidate`, `/pin`, `/unpin`) — through a marketplace manifest, so you can
install it once and invoke memory from any session:

```bash
/plugin marketplace add amphetamarina/Bettyjane   # or a local path to this repo
/plugin install bettyjane@bettyjane
```

The CLI needs `bun` on `PATH` and your wallet env vars (`BJ_MNEMONIC` /
`BJ_NETWORK`). Reading memory needs only `BJ_MNEMONIC`; the write verbs spend real
value, so nothing is written unless you run them.

## Project layout

```
bin/                the bj CLI — a verb per capability (the portable interface)
capture/            turn rendering + the pluggable distiller (BJ_DISTILL_CMD)
commands/           Claude Code skills, one per verb (remember, capture, pin, ...)
examples/           runnable scripts (the agent-verb loop, feature tour)
explorer/           the web view of live memory (local server + Vercel function)
public/             the explorer's static page (served locally and on Vercel)
src/
  domain/           pure, chain-agnostic model (memo, author, funding, retrieval)
  application/      the integration API (loadMemory / saveMemory)
  infrastructure/
    ecash/          eCash adapters: wallet, chronik, codec, minter, reader, network
test/               bun:test suites, one per module (e2e/ is gated, live)
docs/               the spec and per-subsystem notes
```

## Documentation

- [docs/SPEC.md](docs/SPEC.md) — the full design and rationale
- [docs/keys-and-addresses.md](docs/keys-and-addresses.md) — the two-key, two-author model
- [docs/coin-format.md](docs/coin-format.md) — the on-chain memo (OP_RETURN) format
- [docs/funding.md](docs/funding.md) — funding an address and waiting for it
- [docs/testnet-and-e2e.md](docs/testnet-and-e2e.md) — testnet funding, examples, and the e2e suite

## Contributing

See [AGENTS.md](AGENTS.md) for the architecture, conventions, and gotchas.
