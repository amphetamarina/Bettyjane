# Dust memory-coin format (v1)

The on-chain shape of a single Bettyjane memory. Every memory is one **dust coin**
sitting at an address, with its text attached in an `OP_RETURN` output minted in
the same transaction. This document is the wire spec; `src/coin-format.js` is the
reference implementation.

## The coin

| Field | Value |
| --- | --- |
| Value | `546` satoshis (eCash dust, `5.46 XEC`) — constant `MEMO_COIN_SATS` |
| Location | the agent's memory address (`MEMORY`) or the human's pin address (`PIN`) |
| Live = remembered | an unspent coin is a current memory; spending it is forgetting |

The satoshi value carries no information. The coin's *existence* is the memory; its
*text* is the `OP_RETURN`; its *id* is the outpoint (`txid:vout`).

## The `OP_RETURN` script

```
OP_RETURN <LOKAD_ID> <HEADER> <PAYLOAD>
```

Each `<...>` is a pushdata op. The whole script must stay within eCash's
**223-byte** standardness limit (`OP_RETURN_MAX_BYTES`).

| Push | Size | Contents |
| --- | --- | --- |
| `LOKAD_ID` | 4 bytes | ASCII `BJNE`. Protocol prefix (eCash app-identifier convention) so indexers can filter Bettyjane coins and we never collide with another app. |
| `HEADER` | 3 bytes | `[VERSION, KIND, CONTENT_TYPE]` — see below. |
| `PAYLOAD` | ≤ 211 bytes | The note (UTF-8) for `TEXT`, or raw pointer bytes for `POINTER`. |

### `HEADER` bytes

| Byte | Name | Values |
| --- | --- | --- |
| 0 | `VERSION` | `0x01` (unsigned), `0x02` (author-signed, see below) |
| 1 | `KIND` | `0x01` = `MEMORY` (agent), `0x02` = `PIN` (human), `0x03` = `CONSENSUS` (2-of-2, see below) |
| 2 | `CONTENT_TYPE` | `0x00` = `TEXT` (inline UTF-8), `0x01` = `POINTER` (off-coin reference), `0x02` = `ENCRYPTED` (ECIES ciphertext) |

`KIND` records who authored the coin and its role in the two-author model: the
agent's churning working memories vs. the human's durable pins. The permission to
write or spend is enforced by the signature (the controlling key), not by this
byte — `KIND` is a self-description for readers, not an access check.

The three header fields share **one** push on purpose: a single-byte push of a
small integer collapses to a bare `OP_N` opcode under minimal-push encoding, which
is ambiguous to parse. A 3-byte push never collapses.

### `PAYLOAD`

- `TEXT`: the note as UTF-8. Capped at **`MAX_PAYLOAD_BYTES = 211`** bytes — a
  *byte* budget, not a character count (multibyte characters cost more). Derived as
  `223 − OP_RETURN(1) − LOKAD push(5) − HEADER push(4) − payload push prefix(2)`.
- `POINTER`: a reference to content stored off-coin, for notes larger than the
  inline limit. The payload is a run of **32-byte transaction ids**, in order —
  the chunk transactions the note was split across. Each chunk is a data-only
  transaction (an `OP_RETURN` carrying a `MEMORY`/`TEXT` slice, with change but
  **no dust coin**, so it never joins the live set), and the full note is the
  chunks concatenated. A pointer payload holds at most
  `MAX_POINTER_CHUNKS = floor(211 / 32) = 6` txids, so the longest storable
  memory is `MAX_MEMORY_BYTES = 6 × 211 = 1266` bytes.

### Author signatures (v2)

A coin's *ownership* already proves who can spend it, but that proof only holds in
the spend transaction. A memo read out of context — copied from a block explorer,
say — carried no proof of its author. A **v2** memo closes that gap by appending
one more push to the v1 layout:

```
OP_RETURN <LOKAD_ID> <HEADER (version 0x02)> <PAYLOAD> <SIGNATURE>
```

| Push | Size | Contents |
| --- | --- | --- |
| `SIGNATURE` | 65 bytes | A recoverable ECDSA signature (`SIGNATURE_BYTES`) over `sha256(LOKAD_ID ‖ HEADER ‖ PAYLOAD)`, made with the author's key. |

Verification needs nothing else on chain: the verifier recovers the signing
pubkey from the signature (`Ecc.recoverSig`), hashes it (`shaRmd160`), and checks
that hash equals the pubkey hash of the address holding the coin. The signature
is over the v2 header, so altering the version, kind, content type, or payload
invalidates it. As with `KIND`, this is not a new permission — the controlling
key is still the only authority — it is *portable proof of authorship*.

Because the 65-byte signature consumes part of the `OP_RETURN` budget, an inline
signed payload is capped at `MAX_SIGNED_PAYLOAD_BYTES` (the unsigned limit minus
the signature push). The minter signs inline `TEXT` notes that fit; longer notes
and `POINTER` heads fall back to the unsigned v1 encoding. v1 coins remain valid
and decode unchanged — `decodeMemo` accepts both versions and drops the signature;
`decodeSignedMemo` / `verifyMemoAuthor` expose and check it.

### Consensus memories (2-of-2)

Above the unilateral agent memories and human pins sits a shared-truth tier: a
**consensus memory** that neither key can write or forget alone. Its coin lives
at a **2-of-2 P2SH** address derived from both public keys, so every spend —
minting or forgetting — needs both signatures. The memo carries
`KIND = CONSENSUS`; as always the byte only labels it, the 2-of-2 script is the
actual enforcement.

- `consensusRedeemScript([pubA, pubB])` builds the `OP_2 <pubA> <pubB> OP_2
  OP_CHECKMULTISIG` redeem script (pubkeys in canonical order, so the address is
  independent of argument order); `consensusAddress(...)` is its **P2SH20**
  cashaddr (eCash has P2SH20 only — fine for a 2-of-2 between two known keys).
- `ConsensusMinter.mint`/`forget` spend the P2SH coin with `consensusSignatory`,
  which signs the input with both keys (in pubkey order, as `OP_CHECKMULTISIG`
  requires) and assembles the `OP_0 <sigA> <sigB> <redeemScript>` scriptSig.

Because Bettyjane derives both keys from one mnemonic, the two signatures are
made together rather than handed between machines. A cross-machine PSBT handoff —
where the human and agent run on different hosts — is a later refinement; the
on-chain coin is identical either way.

### Encrypted private memories

The chain is public, so the capture policy is to never write a secret. Encryption
turns that from *exclude* into *protect*: a note can live on chain as ciphertext
that only the holder of a key can read. A memory with `CONTENT_TYPE = ENCRYPTED`
carries, as its payload, an **ECIES** blob:

```
ephemeralPubkey(33) ‖ iv(12) ‖ ciphertext(n) ‖ tag(16)
```

built from audited primitives — never a hand-rolled cipher:

- **ECDH** over secp256k1 (`@noble/curves`) between a fresh ephemeral key and the
  recipient's public key yields a shared secret;
- **HKDF-SHA256** (`node:crypto`) derives a 32-byte key from it;
- **AES-256-GCM** (`node:crypto`) encrypts and authenticates the note.

The fresh ephemeral key makes each encryption unique; GCM's tag makes a wrong key
or any tampering fail loudly rather than return garbage. `Minter.rememberPrivate`
encrypts a note to a recipient pubkey (encrypt to your own pubkey to remember to
yourself) and mints the ciphertext; decryption is a separate keyed step
(`decryptWithSeckey`) done locally — the reader and explorer show `[encrypted]`
without the key. Encrypted memos are unsigned and inline-only: a blob over
`MAX_PAYLOAD_BYTES` is rejected (splitting encrypted notes across a pointer chain
is a follow-up).

This is **opt-in** — `rememberPrivate` is an explicit call, not wired into the
automatic capture path, so nothing is encrypted to the chain without intent.

### Batching a turn's notes with eMPP

A substantive turn can yield several notes. Rather than one transaction per note,
they can ride in a single transaction using an **eCash Multipurpose Payload
(eMPP)** `OP_RETURN`:

```
OP_RETURN OP_RESERVED <section_0> <section_1> ... <section_{n-1}>
```

Each `<section_i>` is one push whose bytes are a whole Bettyjane memo packed
together: `LOKAD_ID ‖ [VERSION, KIND, CONTENT_TYPE] ‖ PAYLOAD`. The transaction
lays **one dust coin per section**, at outputs `1..n` in section order (the
`OP_RETURN` is output `0`), so every note remains an independently forgettable
coin — `forget(id)` spends a single section's dust coin and leaves the rest live.
The reader maps the dust coin at output `k` back to section `k-1`.

`encodeMemoBatch` builds the script (capped at the 223-byte `OP_RETURN` limit);
`batchMemos` greedily packs a list of notes into batches that each fit, so a
caller mints one transaction per batch. Foreign eMPP sections (a different
`LOKAD`) are skipped on decode, so Bettyjane can share an eMPP transaction with
other eCash protocols. Batched sections are **unsigned (v1)**; signing batched
sections (combining with the v2 signature) is a follow-up, so the live capture
path still mints signed single memos for now.

### The large-content pointer scheme

`remember(text)` chooses the representation by size, transparently:

- **≤ 211 bytes** → one inline `TEXT` memory coin (the common case).
- **larger** → `chunkText` splits it into ≤211-byte pieces, each minted as a
  data-only chunk transaction (`Minter.mintData`); the memory coin is then a
  `POINTER` whose payload is those chunk txids in order.

`MemoReader.resolveText(coin)` is the inverse: it returns inline text directly,
or fetches a pointer's chunk transactions and concatenates them back into the
original note. The off-coin chunks are permanent chain history; forgetting the
pointer coin removes the memory from the live set as usual.

## API

The `Memo` domain model (`src/domain/memo.ts`) is pure and chain-agnostic; the
codec (`src/infrastructure/ecash/memo-codec.ts`) maps it to and from a `Script`.

```ts
import { memory, pin, text, pointer } from "./src/domain/memo";
import { encodeMemo, decodeMemo, isMemoScript } from "./src/infrastructure/ecash/memo-codec";

encodeMemo(memory(text("note")));                  // -> Script (the OP_RETURN output)
encodeMemo(pin(text("standing instruction")));
encodeMemo(memory(pointer(bytes)));                // CONTENT_TYPE POINTER

decodeMemo(script);   // -> Memo | null
isMemoScript(script); // -> boolean
```

`text()` and `pointer()` are smart constructors that reject empty content. The
211-byte size limit is an eCash constraint, enforced by the codec at encode time
(`MemoTooLargeError`).

`decodeMemo` returns `null` for a script that is not a Bettyjane memo at all (not
an `OP_RETURN`, or a foreign protocol prefix), so callers can cheaply skip foreign
coins while scanning an address. It **throws** (`MalformedMemoError`,
`UnsupportedVersionError`) when the script carries our prefix but the rest is
malformed or an unsupported version.

## Example

A human pin, `"Always cite the eCash upgrade date as 2025-11-15."`, encodes to a
60-byte script:

```
6a 04 424a4e45 03 010200 31 416c77617973...2e
^OP_RETURN     ^header    ^49-byte text push
   ^BJNE          v1,PIN,TEXT
```
