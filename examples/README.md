# Examples

Runnable scripts that drive Bettyjane against the live eCash **testnet** using
only the public API. They are the human-facing companion to the gated end-to-end
tests in [`test/e2e`](../test/e2e) — same flow, but narrated and meant to be run
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

## Funding (manual)

The script waits for funding; you supply it out of band. There is no headless
auto-funding:

- The public testnet faucet <https://faucet.fabien.cash/> is browser-only and is
  frequently drained (it asks that unused coins be returned to its address).
- The official [`cashtab-faucet`](https://github.com/Bitcoin-ABC/bitcoin-abc/tree/master/apps/cashtab-faucet)
  is reCAPTCHA-gated and mainnet-oriented, so it cannot be scripted either.

To fund:

1. Run the script and copy the printed `ectest:` agent address.
2. Open the faucet in a browser (or send from your own testnet wallet) and send
   testnet XEC to that address.
3. The script detects the coins and continues.

Reuse one funded mnemonic via `BJ_MNEMONIC` so you only top up rarely; the
recycling loop keeps the balance roughly stable apart from fees. Top up again
from the faucet when fees have ground the balance down.
