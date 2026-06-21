# Testnet, regtest, and end-to-end tests

The unit suites are hermetic: they run against fakes and touch no network, so
`mise run test` is fast and deterministic. Proving the system against a real node
needs a live chain and Chronik, which is what the examples and the gated
end-to-end suite are for. There are two ways to get a funded chain:

- **regtest**: a private chain you run yourself, where coins are generated on
  demand. No faucet, fully deterministic. This is what CI uses.
- **testnet**: the public test network. Realistic, but funding is a manual,
  unreliable step (see below).

## Regtest (no faucet), the CI path

The [`E2E (regtest)`](../.github/workflows/e2e.yml) workflow downloads Bitcoin
ABC, starts a regtest node with in-node Chronik, generates blocks to the agent
address so the coinbases mature, then runs the e2e suite against the local
Chronik. Coins are generated locally and worthless, so the wallet phrase is a
throwaway constant and there is no secret to manage. It runs on pull requests,
pushes to `main`, and manual dispatch.

To run the same thing locally you need the `bitcoind`/`bitcoin-cli` from a
[Bitcoin ABC release](https://www.bitcoinabc.org/) on your PATH:

```bash
# 1. Start a regtest node with Chronik bound to 127.0.0.1:8331
RPC="-regtest -rpcuser=bj -rpcpassword=bj -rpcport=18443"
bitcoind $RPC -datadir=/tmp/bj-regtest -daemon -chronik -chronikbind=127.0.0.1:8331

# 2. Fund the agent. Coinbases mature after 100 blocks and the Minter spends all
#    of an address's coins at once, so generate the agent's coins, then mine 100
#    more to a different address so every agent coin is mature.
export BJ_NETWORK=regtest
export BJ_MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
AGENT="$(bun test/e2e/print-address.ts agent)"
PAD="$(bun test/e2e/print-address.ts human)"
bitcoin-cli $RPC generatetoaddress 2 "$AGENT"
bitcoin-cli $RPC generatetoaddress 100 "$PAD"

# 3. Run the e2e suite against the local Chronik
BJ_CHRONIK_URL=http://127.0.0.1:8331 mise run test-e2e
```

The address must use the `ecregtest:` prefix, which `BJ_NETWORK=regtest` selects.

## Testnet funding (manual, unreliable)

Funding a testnet address is an out-of-band step, and there is no headless
auto-funding:

- The public testnet faucet <https://faucet.fabien.cash/> is browser-only and is
  frequently down or drained, at the time of writing it was not working.
- The official [`cashtab-faucet`](https://github.com/Bitcoin-ABC/bitcoin-abc/tree/master/apps/cashtab-faucet)
  guards every claim endpoint with reCAPTCHA and validates `ecash:` (mainnet)
  addresses, so it cannot be scripted and is not aimed at testnet.

Faucet trackers (faucet-list.com, bestfaucetsites.com) list no working XEC
testnet faucet. So on testnet you fund from your own coins (or a faucet if one
comes back up) and let the tooling wait via `ChronikGateway.awaitFunding`.
Because of this, regtest is the recommended path for repeatable runs.

### Recycling

`forget` (and the underlying `Minter.spend`) sweeps a coin's value back to the
same address. A funded wallet therefore recycles across runs: each
remember/forget cycle returns the dust to the wallet and only spends network
fees.

## Running the example loop

[`examples/full-loop.ts`](../examples/full-loop.ts) derives or recovers a wallet,
waits for funding, then runs remember → list → forget. It honors `BJ_NETWORK`
and `BJ_CHRONIK_URL`, so it works against regtest or testnet:

```bash
# Against testnet (fund the printed address yourself)
BJ_MNEMONIC="twelve word phrase ..." bun examples/full-loop.ts

# Against a local regtest node (after generating coins as above)
BJ_NETWORK=regtest BJ_CHRONIK_URL=http://127.0.0.1:8331 \
  BJ_MNEMONIC="abandon ... about" bun examples/full-loop.ts
```

## The e2e suite

[`test/e2e`](../test/e2e) asserts the flow on chain. The block is wrapped in
`describe.skipIf(!BJ_MNEMONIC)`, so the default `bun test` collects but skips it,
the hermetic suite stays green without a secret or network. It reads `BJ_NETWORK`
and `BJ_CHRONIK_URL` to target regtest or testnet, refuses to run on mainnet, and
waits for funding before minting so it does not race Chronik indexing.

## CI split

- The main [`CI`](../.github/workflows/ci.yml) workflow runs `bun test` on every
  push and pull request and stays hermetic, it never runs the e2e suite.
- The [`E2E (regtest)`](../.github/workflows/e2e.yml) workflow runs the live suite
  against a regtest node on pull requests, pushes to `main`, and manual dispatch,
  so a regression blocks the merge. It needs no faucet and no secret. The
  downloaded Bitcoin ABC node and the bun cache are cached across runs to keep it
  fast; bump `ABC_VERSION` in the workflow to track a newer release.
