# Bettyjane

An experiment in giving an AI agent a persistent memory, and a readable trace of
how it changes, stored as coins on [eCash](https://e.cash) (XEC), a blockchain I
know well. Each memory is one coin; the agent's mind is the set of coins it holds,
and the chain keeps the history of every change. I used eCash because I know it,
not because it is the only way to do this.

Live instance: **[bettyjane.marina.cash](https://bettyjane.marina.cash)**.

## How it works

A memory is a tiny coin. **Remembering** mints one; **forgetting** spends it. The
unspent coins at an address are what the team remembers now; the chain is the
history of how that set changed. Nothing lives on your laptop; if the process
dies, the memory is still on chain.

There are two authors, each with their own key:

- the **agent** writes fast, churning **memories**;
- the **human** writes rare, durable **pins**: standing instructions the agent
  must not lose.

Every coin is signed, so authorship is provable, and the agent's key cannot touch
the human's pins. Four verbs, split by key: `remember` / `forget` for the agent,
`pin` / `unpin` for the human.

This repo is the memory layer: it derives the keys, encodes and decodes the
on-chain format, mints and reads coins, picks a small working set each turn, and
tidies duplicates. The LLM and the loop driving it live outside. Full design in
**[docs/SPEC.md](docs/SPEC.md)**.

## What's built

Beyond the four verbs, each backward compatible with existing coins:

- **Signed memories**: authorship provable from the coin alone (`authorVerified`).
- **Namespaces**: partition memory into separate watchable addresses (BIP-44).
- **eMPP batching**: a turn's notes in one transaction, each still forgettable.
- **Encrypted memories**: ECIES ciphertext on chain, readable only with the key.
- **2-of-2 consensus memories**: a coin neither key can write or forget alone.

Tour them offline with [`examples/features.ts`](examples/features.ts); the wire
format is in [docs/coin-format.md](docs/coin-format.md).

## Quickstart

```bash
mise install        # pinned Bun toolchain
mise run install    # dependencies
mise run test       # tests
mise run typecheck  # types
```

## CLI

Every capability is a `bj` verb, so any agent (or a shell loop) gets on-chain
memory by shelling out:

```bash
bun bin/bj.ts load                                 # before a turn: load memory
printf '%s' "$turn_text" | bun bin/bj.ts capture   # after a turn: distill + mint
bun bin/bj.ts consolidate                          # session end: tidy duplicates
bun bin/bj.ts inspect <txid> [--json]              # decode a memo on chain
```

`load`, `remember`, `forget`, `private`, `consensus`, `pin`, `unpin`, `capture`,
`consolidate`, `inspect`, `init` are all verbs (`--help` for the full list). Writes
need `BJ_MNEMONIC` / `BJ_NETWORK`; reads need only `BJ_MNEMONIC`. Capture distills
through `BJ_DISTILL_CMD` (any model CLI) or the bundled `claude`.

## Explorer

A read-only web view, hosted at
**[bettyjane.marina.cash](https://bettyjane.marina.cash)** and runnable locally:

```bash
bun run watch                                   # type addresses in the page
bun run watch ecash:qq3u… --human ecash:qpry…   # or pre-fill them
```

**Explore** shows one team's live memory, pins and memories side by side, polled
from the chain, with a toggle for forgotten coins. **Discover** pools every memory
minted under the `BJNE` tag, whoever wrote it. Default `http://localhost:4173`;
deploys to Vercel by importing the repo.

## Library

```ts
import { ChronikGateway, Minter, Wallet, generateMnemonic, pin, text } from "./src/index";

const wallet = Wallet.fromMnemonic(generateMnemonic(), { prefix: "ectest" });
const human = wallet.signer("human");

const chronik = ChronikGateway.fromNetwork("testnet");
await chronik.awaitFunding(human.address, { minimumSats: 10_000n }); // fund it first

const minter = Minter.fromNetwork("testnet");
await minter.mintAll([pin(text("name: Bettyjane")), pin(text("goal: shared memory"))], human);
```

The public API is re-exported from [`src/index.ts`](src/index.ts); a brain
integrates through `loadMemory` / `saveMemory`.

## Plugin (Claude Code)

The repo installs as a plugin exposing the verbs as slash commands:

```bash
/plugin marketplace add amphetamarina/Bettyjane
/plugin install bettyjane@bettyjane
```

`/load` `/remember` `/forget` `/pin` `/unpin` `/private` `/consensus` `/capture`
`/consolidate`: same verbs, same wallet env vars. Writes spend real value, so
nothing happens unless you run them.

## Tests

`mise run test` is hermetic (fakes, no network). On-chain coverage is separate and
gated on `BJ_MNEMONIC`:

```bash
BJ_MNEMONIC="twelve words ..." mise run test-e2e               # testnet
BJ_NETWORK=regtest BJ_CHRONIK_URL=http://127.0.0.1:8331 \
  BJ_MNEMONIC="abandon ... about" mise run test-e2e            # regtest (CI)
```

See [docs/testnet-and-e2e.md](docs/testnet-and-e2e.md).

## Layout

```
bin/                       the bj CLI, a verb per capability
capture/                   turn rendering + pluggable distiller (BJ_DISTILL_CMD)
commands/                  Claude Code skills, one per verb
examples/                  runnable scripts (agent loop, feature tour)
explorer/                  web view (local server + Vercel function)
public/                    the explorer's static page
src/domain/                pure, chain-agnostic model
src/application/           integration API (loadMemory / saveMemory)
src/infrastructure/ecash/  eCash adapters
test/                      bun:test suites (e2e/ is gated)
docs/                      spec and per-subsystem notes
```

## Docs

- [SPEC.md](docs/SPEC.md): full design
- [keys-and-addresses.md](docs/keys-and-addresses.md): the two-key model
- [coin-format.md](docs/coin-format.md): the on-chain memo format
- [funding.md](docs/funding.md): funding an address
- [testnet-and-e2e.md](docs/testnet-and-e2e.md): testnet and e2e

See [AGENTS.md](AGENTS.md) for architecture and conventions.
