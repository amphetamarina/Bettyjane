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
| 1 | `KIND` | `0x01` = `MEMORY` (agent), `0x02` = `PIN` (human) |
| 2 | `CONTENT_TYPE` | `0x00` = `TEXT` (inline UTF-8), `0x01` = `POINTER` (off-coin reference) |

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

### Author signatures (v2, AMP-239)

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

### The large-content pointer scheme (AMP-208)

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
