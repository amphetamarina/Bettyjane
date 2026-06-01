export type { Memo, MemoContent, MemoKind } from "./domain/memo";
export { EmptyMemoError, memory, pin, pointer, text } from "./domain/memo";

export type { Author } from "./domain/author";
export { AUTHORS, authorOf, kindOf } from "./domain/author";

export type { Account, FromMnemonicOptions, SigningKey, WalletOptions } from "./infrastructure/ecash/wallet";
export {
  InvalidEntropyError,
  Wallet,
  XEC_COIN_TYPE,
  derivationPath,
  generateMnemonic,
} from "./infrastructure/ecash/wallet";

export { decodeMemo, encodeMemo, isMemoScript } from "./infrastructure/ecash/memo-codec";
export { DUST_SATS, LOKAD_ID, MAX_PAYLOAD_BYTES, PROTOCOL_VERSION } from "./infrastructure/ecash/protocol";
export {
  MalformedMemoError,
  MemoCodecError,
  MemoTooLargeError,
  UnsupportedVersionError,
} from "./infrastructure/ecash/errors";
