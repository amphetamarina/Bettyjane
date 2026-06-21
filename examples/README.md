# Examples

Runnable scripts that drive Bettyjane against the live eCash **testnet** using
only the public API. They are the human-facing companion to the gated end-to-end
tests in [`test/e2e`](../test/e2e), same flow, but narrated and meant to be run
by hand.

## full-loop.ts

Derives (or recovers) a wallet, waits for the agent address to be funded, then
runs the agent verbs end to end: `remember` a note, read it back with
`listLiveCoins`, and `forget` it. Forgetting sweeps the coin's value back to the
same address, so funds recycle across runs and only network fees are spent.

```bash
# Recover a known wallet (reuses its testnet funds across runs)
BJ_MNEMONIC="twelve word phrase ..." bun examples/full-loop.ts

# Or generate a throwaway wallet (prints the phrase so you can reuse it)
bun examples/full-loop.ts
```

## features.ts

A guided tour of the layered features, using only the public API. Every step
runs **offline** (no network, no funding), so it doubles as a "how to use each
feature" reference you can run as-is:

```bash
bun examples/features.ts            # uses a throwaway phrase
BJ_MNEMONIC="twelve word phrase ..." bun examples/features.ts
```

It covers, with the on-chain call for each shown in a comment:

- **Content-signed memories**: `signingDigest` + `encodeSignedMemo`, then
  `verifyMemoAuthor`. On chain: `minter.remember(note, signer)` signs inline text
  automatically.
- **Namespaces**: `wallet.address("agent", "billing")` derives a separate,
  watchable address; the default namespace reproduces the original.
- **eMPP batching**: `batchMemos` + `encodeMemoBatch` pack several notes into one
  `OP_RETURN`. On chain: `minter.rememberBatch([...notes], signer)`.
- **Encrypted private memories**: `encryptToPubkey` / `decryptWithSeckey` round
  trip. On chain: `minter.rememberPrivate(note, recipientPubkey, signer)`.
- **Consensus memories**: `consensusAddress([a, b])` is the 2-of-2 P2SH address.
  On chain: `ConsensusMinter.fromNetwork(net).mint(consensus(text(note)), signers)`.

## Funding

The script honors `BJ_NETWORK` (default testnet) and `BJ_CHRONIK_URL`, so you can
fund it two ways.

### Regtest (recommended, no faucet)

Run a local regtest node and generate coins to the address yourself, fully
self-contained, no faucet. See
[docs/testnet-and-e2e.md](../docs/testnet-and-e2e.md) for the node + `BJ_CHRONIK_URL`
setup, then:

```bash
BJ_NETWORK=regtest BJ_CHRONIK_URL=http://127.0.0.1:8331 \
  BJ_MNEMONIC="abandon ... about" bun examples/full-loop.ts
```

### Testnet (manual, unreliable)

There is no headless auto-funding: the public faucet
<https://faucet.fabien.cash/> is browser-only and frequently down (not working at
the time of writing), and the official `cashtab-faucet` is reCAPTCHA-gated and
mainnet-only. To fund: run the script, copy the printed `ectest:` address, send
it testnet XEC from your own wallet (or a faucet if one is up), and the script
detects the coins and continues. Reuse one funded mnemonic via `BJ_MNEMONIC`; the
recycling loop keeps the balance roughly stable apart from fees.
