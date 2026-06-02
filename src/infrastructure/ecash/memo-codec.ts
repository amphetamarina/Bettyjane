import { OP_RETURN, Script, fromHex, isPushOp, pushBytesOp, strToBytes } from "ecash-lib";
import type { Memo, MemoContent } from "../../domain/memo.js";
import {
  LOKAD_ID,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  codeToContentType,
  codeToKind,
  contentTypeToCode,
  kindToCode,
} from "./protocol.js";
import { MalformedMemoError, MemoTooLargeError, UnsupportedVersionError } from "./errors.js";

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
  const header = Uint8Array.of(
    PROTOCOL_VERSION,
    kindToCode(memo.kind),
    contentTypeToCode(memo.content.type),
  );
  return Script.fromOps([
    OP_RETURN,
    pushBytesOp(LOKAD_ID),
    pushBytesOp(header),
    pushBytesOp(payload),
  ]);
}

/**
 * Decode a coin's output script. Returns null when the script is not a
 * Bettyjane memo (not OP_RETURN, or a foreign protocol prefix), so address
 * scans can skip foreign coins cheaply. Throws when the prefix is ours but the
 * rest is malformed or an unsupported version.
 */
export function decodeMemo(script: Script): Memo | null {
  const ops = script.ops();
  if (ops.next() !== OP_RETURN) return null;

  const lokad = nextData(ops);
  if (!lokad || !equalBytes(lokad, LOKAD_ID)) return null;

  const header = nextData(ops);
  if (!header || header.length !== 3) throw new MalformedMemoError("missing 3-byte header");
  const version = header[0]!;
  if (version !== PROTOCOL_VERSION) throw new UnsupportedVersionError(version);

  const kind = codeToKind(header[1]!);
  const contentType = codeToContentType(header[2]!);

  const payload = nextData(ops);
  if (!payload || payload.length === 0) throw new MalformedMemoError("missing payload");

  const content: MemoContent =
    contentType === "text"
      ? { type: "text", text: new TextDecoder().decode(payload) }
      : { type: "pointer", pointer: payload };

  return { kind, content };
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

function payloadOf(content: MemoContent): Uint8Array {
  return content.type === "text" ? strToBytes(content.text) : content.pointer;
}

function nextData(ops: ReturnType<Script["ops"]>): Uint8Array | null {
  const op = ops.next();
  return op !== undefined && isPushOp(op) ? op.data : null;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}
