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
| 0 | `VERSION` | `0x01` (this version) |
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
  inline limit. This format reserves the `CONTENT_TYPE` and carries the pointer's
  raw bytes; the internal tag/txid structure of a pointer is defined by the
  large-content scheme (AMP-208), layered on top without changing this wire format.

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
