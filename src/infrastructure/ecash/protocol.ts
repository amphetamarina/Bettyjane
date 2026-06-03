import {
  DEFAULT_DUST_SATS,
  OP_RETURN,
  OP_RETURN_MAX_BYTES,
  Script,
  pushBytesOp,
  strToBytes,
} from "ecash-lib";
import type { MemoContent, MemoKind } from "../../domain/memo.js";
import { MalformedMemoError } from "./errors.js";

/** 4-byte app identifier ("BettyjaNE"), pushed right after OP_RETURN. */
export const LOKAD_ID = strToBytes("BJNE");

export const PROTOCOL_VERSION = 1;

/**
 * Version of a memo that carries an author signature over its content (AMP-239).
 * A v2 memo appends one more push, a {@link SIGNATURE_BYTES}-byte recoverable
 * ECDSA signature, after the payload. v1 memos remain valid and unsigned.
 */
export const SIGNED_PROTOCOL_VERSION = 2;

/** Versions this build knows how to decode. */
export const SUPPORTED_VERSIONS: readonly number[] = [PROTOCOL_VERSION, SIGNED_PROTOCOL_VERSION];

/**
 * A recoverable ECDSA signature: 64 bytes (r, s) plus a 1-byte recovery id, so a
 * verifier recovers the signing pubkey from the signature alone and needs nothing
 * else stored on chain.
 */
export const SIGNATURE_BYTES = 65;

/** Every memory coin holds exactly this much dust; the value carries no data. */
export const DUST_SATS = DEFAULT_DUST_SATS;

type ContentType = MemoContent["type"];

const KIND_TO_CODE: Record<MemoKind, number> = { memory: 0x01, pin: 0x02 };
const CONTENT_TO_CODE: Record<ContentType, number> = { text: 0x00, pointer: 0x01, encrypted: 0x02 };
const CODE_TO_KIND = invert(KIND_TO_CODE);
const CODE_TO_CONTENT = invert(CONTENT_TO_CODE);

export const kindToCode = (kind: MemoKind): number => KIND_TO_CODE[kind];
export const contentTypeToCode = (type: ContentType): number => CONTENT_TO_CODE[type];

export function codeToKind(code: number): MemoKind {
  const kind = CODE_TO_KIND.get(code);
  if (kind === undefined) throw new MalformedMemoError(`unknown kind code ${code}`);
  return kind;
}

export function codeToContentType(code: number): ContentType {
  const type = CODE_TO_CONTENT.get(code);
  if (type === undefined) throw new MalformedMemoError(`unknown content-type code ${code}`);
  return type;
}

/** A payload near the limit is pushed with a 2-byte length prefix (OP_PUSHDATA1). */
const PUSH_PREFIX_BYTES = 2;

/**
 * Largest inline payload, in bytes, that fits eCash's OP_RETURN standardness
 * limit after the LOKAD id, the 3-byte header, and the payload's push prefix.
 */
export const MAX_PAYLOAD_BYTES =
  OP_RETURN_MAX_BYTES - headerScriptBytes() - PUSH_PREFIX_BYTES;

/**
 * Largest inline payload for a signed (v2) memo: the unsigned budget minus the
 * bytes the signature push adds to the script. A note longer than this cannot be
 * content-signed inline and falls back to the unsigned pointer chain.
 */
export const MAX_SIGNED_PAYLOAD_BYTES = MAX_PAYLOAD_BYTES - signaturePushBytes();

/** A transaction id is 32 bytes; a pointer payload is a run of them. */
export const TXID_BYTES = 32;

/** Most chunk txids that fit one pointer payload, hence the longest chain. */
export const MAX_POINTER_CHUNKS = Math.floor(MAX_PAYLOAD_BYTES / TXID_BYTES);

/** Largest memory text remember() can store: inline, or split across a pointer chain. */
export const MAX_MEMORY_BYTES = MAX_POINTER_CHUNKS * MAX_PAYLOAD_BYTES;

function headerScriptBytes(): number {
  return Script.fromOps([OP_RETURN, pushBytesOp(LOKAD_ID), pushBytesOp(new Uint8Array(3))])
    .bytecode.length;
}

/** Extra script bytes a signature push adds: the pushdata prefix plus the signature itself. */
function signaturePushBytes(): number {
  return Script.fromOps([pushBytesOp(new Uint8Array(SIGNATURE_BYTES))]).bytecode.length;
}

function invert<K extends string>(map: Record<K, number>): Map<number, K> {
  return new Map((Object.entries(map) as [K, number][]).map(([k, v]) => [v, k]));
}
