# Bettyjane

Persistent, public, tamper-evident memory for a human-plus-agent team, stored as
dust coins on eCash (XEC). Each memory is a tiny coin: the live coins at an
address are what the team remembers now, and the chain is the full history of how
that set changed. There are two authors with two keys — the agent mints churning
working memories, the human mints durable pins — and every coin carries the
signature of whoever wrote it, so authorship is provable and a pin cannot be
erased by the agent's key.

This repository is the memory layer itself: deriving the two keys, watching an
address for funding, encoding the on-chain memo format, and minting memo coins
(build, sign, broadcast). The brain (an LLM) and the runner (your own loop or
Claude Code hooks) live outside it.

The full design and rationale are in [docs/INITIAL_SPEC.md](docs/INITIAL_SPEC.md).

## Status

Early. The library can derive keys and addresses, observe funding, encode and
decode the memo format, and mint memo coins. The first piece of the bootstrap CLI
(`bj inspect`) has landed; the full agent verbs (`remember` / `forget`) are still
in progress. There is no published package yet — consume it as a library from this
repo.

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

A small `bj` tool (litcli style) for reading what actually landed on chain.

```bash
# See the decoded pin / memory in any tx
bun bin/bj.ts inspect a8ef7cba751f22df120e3e8123cdde103303d567cca1fdb71bb6e07750821af7 --network mainnet

# Machine readable (for scripts / agents)
bun bin/bj.ts inspect <txid> --json
```

It prints the memo coin outpoint (`txid:1`), whether the coin is still live (unspent), the kind/content, and the raw OP_RETURN for verification. Use `--network testnet` for test coins.

More commands (`mint`, address scanning, etc.) will grow into the full bootstrap CLI.

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

## Project layout

```
bin/                CLI entrypoints (bj — the litcli-style inspector)
src/
  domain/           pure, chain-agnostic memory model (memo, author, funding)
  infrastructure/
    ecash/          eCash adapters: wallet, chronik, codec, minter, network
test/               bun:test suites, one per module
docs/               design spec and per-subsystem notes
```

## Documentation

- [docs/INITIAL_SPEC.md](docs/INITIAL_SPEC.md) — the full design and rationale
- [docs/keys-and-addresses.md](docs/keys-and-addresses.md) — the two-key, two-author model
- [docs/coin-format.md](docs/coin-format.md) — the on-chain memo (OP_RETURN) format
- [docs/funding.md](docs/funding.md) — funding an address and waiting for it

## Contributing

See [AGENTS.md](AGENTS.md) for the architecture, conventions, and gotchas.
