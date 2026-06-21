import {
  type Ecc,
  OP_RETURN,
  OP_RETURN_MAX_BYTES,
  Script,
  emppScript,
  fromHex,
  isPushOp,
  parseEmppScript,
  pushBytesOp,
  sha256,
  shaRmd160,
  strToBytes,
} from "ecash-lib";
import type { Memo, MemoContent } from "../../domain/memo";
import {
  LOKAD_ID,
  MAX_PAYLOAD_BYTES,
  MAX_SIGNED_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  SIGNATURE_BYTES,
  SIGNED_PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  codeToContentType,
  codeToKind,
  contentTypeToCode,
  kindToCode,
} from "./protocol";
import { MalformedMemoError, MemoTooLargeError, UnsupportedVersionError } from "./errors";

/** A decoded memo together with its on-chain author signature, if any. */
export interface SignedMemo {
  readonly memo: Memo;
  /** The recoverable ECDSA signature carried by a v2 memo, or null for unsigned v1. */
  readonly signature: Uint8Array | null;
  /** The 32-byte digest the signature is over: sha256(LOKAD ++ header ++ payload). */
  readonly digest: Uint8Array;
}

/**
 * Layout: OP_RETURN <LOKAD "BJNE"> <[version, kind, contentType]> <payload>.
 * The header is one 3-byte push because a single-byte push of a small integer
 * collapses to a bare OP_N opcode under minimal-push encoding.
 */
export function encodeMemo(memo: Memo): Script {
  const payload = payloadOf(memo.content);
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new MemoTooLargeError(payload.length, MAX_PAYLOAD_BYTES);
  }
  return Script.fromOps([
    OP_RETURN,
    pushBytesOp(LOKAD_ID),
    pushBytesOp(headerBytes(PROTOCOL_VERSION, memo)),
    pushBytesOp(payload),
  ]);
}

/**
 * The v1 layout plus a trailing {@link SIGNATURE_BYTES}-byte push of a signature
 * over {@link signingDigest}(memo). Payloads are capped at
 * {@link MAX_SIGNED_PAYLOAD_BYTES} to leave room for it.
 */
export function encodeSignedMemo(memo: Memo, signature: Uint8Array): Script {
  const payload = payloadOf(memo.content);
  if (payload.length > MAX_SIGNED_PAYLOAD_BYTES) {
    throw new MemoTooLargeError(payload.length, MAX_SIGNED_PAYLOAD_BYTES);
  }
  if (signature.length !== SIGNATURE_BYTES) {
    throw new MalformedMemoError(`signature must be ${SIGNATURE_BYTES} bytes, got ${signature.length}`);
  }
  return Script.fromOps([
    OP_RETURN,
    pushBytesOp(LOKAD_ID),
    pushBytesOp(headerBytes(SIGNED_PROTOCOL_VERSION, memo)),
    pushBytesOp(payload),
    pushBytesOp(signature),
  ]);
}

/**
 * The 32-byte digest an author signs to vouch for a memo's content:
 * sha256(LOKAD ++ header ++ payload), where the header carries the v2 version.
 */
export function signingDigest(memo: Memo): Uint8Array {
  return digestOf(headerBytes(SIGNED_PROTOCOL_VERSION, memo), payloadOf(memo.content));
}

/**
 * Encode several memos as eMPP sections in one OP_RETURN, each
 * `LOKAD ++ [version, kind, contentType] ++ payload` and unsigned (v1). Throws
 * {@link MemoTooLargeError} past the {@link OP_RETURN_MAX_BYTES} limit; pack with
 * {@link batchMemos} to avoid it.
 */
export function encodeMemoBatch(memos: readonly Memo[]): Script {
  if (memos.length === 0) throw new MalformedMemoError("a memo batch needs at least one memo");
  const sections = memos.map(memoSection);
  const script = emppScript(sections);
  if (script.bytecode.length > OP_RETURN_MAX_BYTES) {
    throw new MemoTooLargeError(script.bytecode.length, OP_RETURN_MAX_BYTES);
  }
  return script;
}

/**
 * Decode an eMPP OP_RETURN into its Bettyjane memos, in section order. Foreign
 * sections (a different LOKAD) are skipped so Bettyjane can share a transaction;
 * returns null when none are ours. Throws on a malformed Bettyjane section.
 */
export function decodeMemoBatch(script: Script): Memo[] | null {
  let sections: Uint8Array[] | undefined;
  try {
    sections = parseEmppScript(script);
  } catch {
    return null;
  }
  if (!sections) return null;
  const memos = sections.filter(isOurSection).map(decodeSection);
  return memos.length > 0 ? memos : null;
}

/**
 * Greedily pack memos into order-preserving batches that each fit one eMPP
 * OP_RETURN. A memo too large to share a batch is returned on its own.
 */
export function batchMemos(memos: readonly Memo[]): Memo[][] {
  const batches: Memo[][] = [];
  let current: Memo[] = [];
  for (const memo of memos) {
    if (current.length > 0 && !fitsBatch([...current, memo])) {
      batches.push(current);
      current = [];
    }
    current.push(memo);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function fitsBatch(memos: Memo[]): boolean {
  try {
    return emppScript(memos.map(memoSection)).bytecode.length <= OP_RETURN_MAX_BYTES;
  } catch {
    return false;
  }
}

/**
 * Decode a coin's output script, or null when it is not a Bettyjane memo (so
 * scans skip foreign coins cheaply). Throws when the prefix is ours but the rest
 * is malformed. The signature is dropped — use {@link decodeSignedMemo} to keep it.
 */
export function decodeMemo(script: Script): Memo | null {
  return parse(script)?.memo ?? null;
}

/**
 * Decode a memo with its signature and the digest it is over, or null for a
 * non-memo script. An unsigned v1 memo has a null signature.
 */
export function decodeSignedMemo(script: Script): SignedMemo | null {
  const parsed = parse(script);
  if (!parsed) return null;
  return {
    memo: parsed.memo,
    signature: parsed.signature,
    digest: digestOf(parsed.header, parsed.payload),
  };
}

/**
 * Whether the memo's signature recovers to the pubkey hash in `ownerScript` (the
 * memo coin's own P2PKH script). False for an unsigned memo, a non-P2PKH owner,
 * or a signature that does not recover or match.
 */
export function verifyMemoAuthor(script: Script, ownerScript: Uint8Array, ecc: Ecc): boolean {
  const parsed = parse(script);
  if (!parsed?.signature) return false;
  const ownerPkh = pkhOfP2pkh(ownerScript);
  if (!ownerPkh) return false;
  try {
    const digest = digestOf(parsed.header, parsed.payload);
    const recovered = ecc.recoverSig(parsed.signature, digest);
    const pubkey = recovered.length === SIGNATURE_BYTES ? ecc.compressPk(recovered) : recovered;
    return equalBytes(shaRmd160(pubkey), ownerPkh);
  } catch {
    return false;
  }
}

interface ParsedMemo {
  readonly memo: Memo;
  readonly signature: Uint8Array | null;
  readonly header: Uint8Array;
  readonly payload: Uint8Array;
}

function parse(script: Script): ParsedMemo | null {
  const ops = script.ops();
  if (ops.next() !== OP_RETURN) return null;

  const lokad = nextData(ops);
  if (!lokad || !equalBytes(lokad, LOKAD_ID)) return null;

  const header = nextData(ops);
  if (!header || header.length !== 3) throw new MalformedMemoError("missing 3-byte header");
  const version = header[0]!;
  if (!SUPPORTED_VERSIONS.includes(version)) throw new UnsupportedVersionError(version);

  const kind = codeToKind(header[1]!);
  const contentType = codeToContentType(header[2]!);

  const payload = nextData(ops);
  if (!payload || payload.length === 0) throw new MalformedMemoError("missing payload");

  const content = contentFrom(contentType, payload);

  let signature: Uint8Array | null = null;
  if (version === SIGNED_PROTOCOL_VERSION) {
    const sig = nextData(ops);
    if (!sig || sig.length !== SIGNATURE_BYTES) {
      throw new MalformedMemoError(`v2 memo needs a ${SIGNATURE_BYTES}-byte signature`);
    }
    signature = sig;
  }

  return { memo: { kind, content }, signature, header, payload };
}

/** Decode a memo from an output script's raw hex, e.g. as Chronik returns it. */
export function decodeMemoHex(scriptHex: string): Memo | null {
  return decodeMemo(new Script(fromHex(scriptHex)));
}

export function isMemoScript(script: Script): boolean {
  try {
    return decodeMemo(script) !== null;
  } catch {
    return true;
  }
}

function headerBytes(version: number, memo: Memo): Uint8Array {
  return Uint8Array.of(version, kindToCode(memo.kind), contentTypeToCode(memo.content.type));
}

function contentFrom(contentType: MemoContent["type"], payload: Uint8Array): MemoContent {
  if (contentType === "text") return { type: "text", text: new TextDecoder().decode(payload) };
  if (contentType === "encrypted") return { type: "encrypted", ciphertext: payload };
  return { type: "pointer", pointer: payload };
}

/** One eMPP section's bytes: LOKAD ++ [version, kind, contentType] ++ payload. */
function memoSection(memo: Memo): Uint8Array {
  const payload = payloadOf(memo.content);
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new MemoTooLargeError(payload.length, MAX_PAYLOAD_BYTES);
  }
  const header = headerBytes(PROTOCOL_VERSION, memo);
  const section = new Uint8Array(LOKAD_ID.length + header.length + payload.length);
  section.set(LOKAD_ID, 0);
  section.set(header, LOKAD_ID.length);
  section.set(payload, LOKAD_ID.length + header.length);
  return section;
}

function isOurSection(section: Uint8Array): boolean {
  return section.length >= LOKAD_ID.length && equalBytes(section.subarray(0, LOKAD_ID.length), LOKAD_ID);
}

function decodeSection(section: Uint8Array): Memo {
  const header = section.subarray(LOKAD_ID.length, LOKAD_ID.length + 3);
  if (header.length !== 3) throw new MalformedMemoError("eMPP section missing 3-byte header");
  if (!SUPPORTED_VERSIONS.includes(header[0]!)) throw new UnsupportedVersionError(header[0]!);
  const kind = codeToKind(header[1]!);
  const contentType = codeToContentType(header[2]!);
  const payload = section.subarray(LOKAD_ID.length + 3);
  if (payload.length === 0) throw new MalformedMemoError("eMPP section missing payload");
  return { kind, content: contentFrom(contentType, payload) };
}

function payloadOf(content: MemoContent): Uint8Array {
  if (content.type === "text") return strToBytes(content.text);
  if (content.type === "encrypted") return content.ciphertext;
  return content.pointer;
}

function digestOf(header: Uint8Array, payload: Uint8Array): Uint8Array {
  const image = new Uint8Array(LOKAD_ID.length + header.length + payload.length);
  image.set(LOKAD_ID, 0);
  image.set(header, LOKAD_ID.length);
  image.set(payload, LOKAD_ID.length + header.length);
  return sha256(image);
}

/** The 20-byte pubkey hash of a standard P2PKH script, or null if it is not one. */
function pkhOfP2pkh(script: Uint8Array): Uint8Array | null {
  // OP_DUP OP_HASH160 <20-byte push> OP_EQUALVERIFY OP_CHECKSIG
  const P2PKH = [0x76, 0xa9, 0x14];
  if (script.length !== 25 || P2PKH.some((byte, i) => script[i] !== byte)) return null;
  if (script[23] !== 0x88 || script[24] !== 0xac) return null;
  return script.subarray(3, 23);
}

function nextData(ops: ReturnType<Script["ops"]>): Uint8Array | null {
  const op = ops.next();
  return op !== undefined && isPushOp(op) ? op.data : null;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}
