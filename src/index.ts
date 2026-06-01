export type { Memo, MemoContent, MemoKind } from "./domain/memo";
export { EmptyMemoError, memory, pin, pointer, text } from "./domain/memo";

export { decodeMemo, encodeMemo, isMemoScript } from "./infrastructure/ecash/memo-codec";
export { DUST_SATS, LOKAD_ID, MAX_PAYLOAD_BYTES, PROTOCOL_VERSION } from "./infrastructure/ecash/protocol";
export {
  MalformedMemoError,
  MemoCodecError,
  MemoTooLargeError,
  UnsupportedVersionError,
} from "./infrastructure/ecash/errors";
