# Testnet funding, examples, and end-to-end tests

The unit suites are hermetic: they run against fakes and touch no network, so
`mise run test` is fast and deterministic. Proving the system against a real node
needs testnet XEC and live Chronik, which is what the examples and the gated
end-to-end suite are for.

## Funding a testnet address

Funding is a manual, out-of-band step. There is no headless auto-funding, because
neither available faucet can be driven from a script:

- The public testnet faucet <https://faucet.fabien.cash/> is browser-only and is
  frequently drained. It runs on a recycling model and asks that unused coins be
  returned to its address (`ectest:qq725wp6vvqvga25ucmf3xk8uac7v3mx4s5qgxq5aq`).
- The official [`cashtab-faucet`](https://github.com/Bitcoin-ABC/bitcoin-abc/tree/master/apps/cashtab-faucet)
  guards every claim endpoint with reCAPTCHA and validates `ecash:` (mainnet)
  addresses, so it cannot be scripted and is not aimed at testnet.

So the workflow is: derive an address, fund it from the faucet in a browser (or
send from your own testnet wallet), and let the tooling wait for the coins via
`ChronikGateway.awaitFunding`.

### Recycling

`forget` (and the underlying `Minter.spend`) sweeps a coin's value back to the
same address. A funded wallet therefore recycles across runs: each
remember/forget cycle returns the dust to the wallet and only spends network
fees. Reuse one mnemonic (via `BJ_MNEMONIC`) so you top up rarely, and refill
from the faucet when fees have ground the balance down.

If the public faucet proves too unreliable, the official `cashtab-faucet` can be
self-hosted (it ships a Docker image) for a controlled, always-funded source.

## Running the example loop

[`examples/full-loop.ts`](../examples/full-loop.ts) derives or recovers a wallet,
waits for funding, then runs remember → list → forget against testnet:

```bash
# Recover a known wallet (reuses its funds across runs)
BJ_MNEMONIC="twelve word phrase ..." bun examples/full-loop.ts

# Or generate a throwaway wallet (prints the phrase to reuse)
bun examples/full-loop.ts
```

## Running the e2e suite

[`test/e2e`](../test/e2e) asserts the same flow on chain. The block is wrapped in
`describe.skipIf(!BJ_MNEMONIC)`, so the default `bun test` collects but skips it —
the hermetic suite stays green without a secret or network. To run it you need a
funded testnet wallet:

```bash
BJ_MNEMONIC="twelve word phrase ..." mise run test-e2e
```

It forces `BJ_NETWORK=testnet` internally, so a run can never spend mainnet XEC.
The agent address (account `m/44'/1899'/0'/0/0`) is the one that must be funded.

## CI

- The main [`CI`](../.github/workflows/ci.yml) workflow runs `bun test` on every
  push and pull request and stays hermetic — it never runs the e2e suite.
- The [`E2E (testnet)`](../.github/workflows/e2e.yml) workflow runs the live suite
  on a weekly schedule and on manual dispatch, kept off the per-PR path to avoid
  live-network flakiness and faucet pressure. It reads the funded wallet from the
  `BJ_MNEMONIC` repository secret and fails loudly if it is missing.
