# Keys and addresses (the two-author model)

Bettyjane's memory is written by two authors: the **agent**, which writes churning
working memories, and the **human**, which writes durable pins. Each author owns a
distinct key and a distinct address. A coin's controlling key is what authorizes
writing it or spending (forgetting) it — **the signature is the permission**. The
`KIND` byte in the [coin format](./coin-format.md) only describes who authored a
coin for readers; it is not an access check.

## One seed, two accounts

Both keys derive from a single BIP-39 mnemonic, so one backup phrase recovers the
whole memory. The two authors are separated as two BIP-44 accounts under eCash's
coin type (`1899`):

| Author | Role (KIND) | Derivation path |
| --- | --- | --- |
| `agent` | `MEMORY` | `m/44'/1899'/0'/0/0` |
| `human` | `PIN` | `m/44'/1899'/1'/0/0` |

Each account derives a compressed secp256k1 public key, whose `HASH160`
(`RIPEMD160(SHA256(pubkey))`) becomes a standard P2PKH **cashaddr** — the agent's
*memory address* and the human's *pin address*.

## Namespaces (AMP-243)

A namespace partitions an author's memory into separate, independently watchable
addresses — one per project or topic, say — without changing the two-author
split. A namespace is the BIP-44 **address index** (the last path component),
while the author stays on the account level:

```
m/44'/1899'/<account>'/0/<namespace index>
```

The namespace **name → index** mapping is a pure function of the name
(`namespaceIndex(name)`), so there is no registry to keep in sync and the same
name always derives the same address. The **default namespace** (`DEFAULT_NAMESPACE`,
the empty string) is index `0`, so naming no namespace reproduces the original
address byte-for-byte. Every other name hashes into the non-hardened index range
and is nudged off `0`, so a named namespace can never collide with the default;
two distinct names colliding is a 1-in-2³¹ event.

```ts
wallet.address("agent");              // default namespace — the original address
wallet.address("agent", "billing");  // a separate, deterministic address
wallet.signer("agent", "billing");   // its signing key, to mint/forget there
```

Each namespace address is funded and watched on its own (`bun run watch <address>`);
fund it from the root address as needed. The CLI derives a namespace's addresses
with `bj init --namespace <name>`.

## API

The `Author` type and its mapping to a memo `KIND` are pure domain
(`src/domain/author.ts`). Key derivation and address encoding are eCash
infrastructure (`src/infrastructure/ecash/wallet.ts`).

```ts
import { Wallet, generateMnemonic } from "./src/index";

const phrase = generateMnemonic();          // fresh 12-word BIP-39 phrase (128-bit)
const wallet = Wallet.fromMnemonic(phrase); // or Wallet.fromSeed(seed)

wallet.address("agent");        // "ecash:q..." — the memory address (fund this)
wallet.account("human");        // { author, path, pubkey, address }
wallet.signingKey("agent");     // { seckey, pubkey } — to spend/forget coins later
```

- `generateMnemonic(strengthBits?)` draws cryptographically random entropy and
  encodes it as a BIP-39 phrase. The default is 128 bits (12 words); 160/192/224/256
  are also accepted (256 → 24 words). Any other strength throws `InvalidEntropyError`.
- `Wallet.fromMnemonic(phrase, { passphrase, prefix })` accepts an optional BIP-39
  passphrase (a different passphrase derives entirely different keys) and a cashaddr
  `prefix` (`"ecash"` mainnet by default, `"ectest"` for testnet).
- `Wallet.fromSeed(seed, { prefix })` skips the mnemonic when the raw seed is known.

The wallet derives on demand and holds no per-author state, so the same wallet
instance can hand out both authors' addresses and keys.

## Loading the key from the environment

`Wallet.fromMnemonic` is the low-level constructor. In the CLI and the Claude
Code hooks the key is not hardcoded — it is read from the environment, so the
seed lives in your shell or a secrets manager and never in the repo.

```ts
import { loadWallet } from "./src/index";

const wallet = loadWallet();        // reads process.env
wallet.signer("human");             // sign pins with the human key
wallet.address("agent");            // the memory address to fund
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `BJ_MNEMONIC` | yes | the BIP-39 phrase that recovers both authors |
| `BJ_PASSPHRASE` | no | optional BIP-39 passphrase (a different one derives different keys) |
| `BJ_NETWORK` | no | `mainnet` or `testnet`; defaults to `testnet` |

- A missing or blank `BJ_MNEMONIC` throws `MissingMnemonicError`.
- An unrecognized `BJ_NETWORK` throws `InvalidNetworkError`.
- `loadWallet(env)` accepts an explicit environment map; with no argument it
  reads `process.env`.

The default network is testnet, so a bootstrap never touches real XEC until you
set `BJ_NETWORK=mainnet` on purpose.
