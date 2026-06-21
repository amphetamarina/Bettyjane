# Funding the memory address

Before the agent can write, its **memory address** (the agent account from
[keys and addresses](./keys-and-addresses.md)) must hold spendable XEC: every
memory coin carries dust, and every write pays a fee. Funding is the first half
of bootstrap.

This module does not *send* the funds, that happens out of band, from your own
wallet or a testnet faucet, to the address `wallet.address("agent")`. What it
does is **observe**: read the address from the chain and decide whether it is
funded yet, and **wait** for the coins to land.

## Network is configurable

A `NetworkConfig` ties a network to the cashaddr prefix the `Wallet` stamps and
the Chronik endpoints the gateway reads. Development defaults to **testnet** so a
bootstrap never touches real XEC; the endpoints are sensible defaults you can
override per deployment.

```ts
import { networkConfig, Wallet, ChronikGateway } from "./src/index";

const config = networkConfig("testnet");               // or "mainnet"
const wallet = Wallet.fromMnemonic(phrase, { prefix: config.prefix });
const chronik = ChronikGateway.fromNetwork(config);
const address = wallet.address("agent");

// Override just the Chronik endpoints, keep the prefix:
networkConfig("testnet", { chronikUrls: ["https://my-chronik.example"] });
```

## Observe and await

`assessFunding` is pure domain: given an address's spendable coins and a policy,
it reports the balance and whether the address is funded. The Chronik gateway
queries the live UTXO set and runs the same assessment.

```ts
const policy = { minimumSats: 1000n };           // enough for the first write

const status = await chronik.fundingStatus(address, policy);
// { confirmedSats, unconfirmedSats, totalSats, coinCount, funded }

// Block until the funds arrive (or a timeout / abort):
const funded = await chronik.awaitFunding(address, policy, {
  pollIntervalMs: 5000,
  timeoutMs: 600_000,
});
```

- `minimumSats` is the threshold for "funded", set it to whatever the first
  write needs (a memory coin's dust plus fee). It is explicit; there is no hidden
  default.
- `requireConfirmed: true` counts only confirmed coins, ignoring mempool ones.
- `awaitFunding` polls `fundingStatus` until `funded`, then resolves with the
  status. It rejects with `FundingTimeoutError` if `timeoutMs` elapses first, and
  honors an `AbortSignal`.
