export type { Memo, MemoContent, MemoKind } from "./domain/memo";
export { EmptyMemoError, memory, pin, pointer, text } from "./domain/memo";

export type { Outpoint } from "./domain/coin-id";
export { InvalidCoinIdError, coinId, parseCoinId } from "./domain/coin-id";

export type { Embedder, ScoredCoin, Vector } from "./domain/embedding-index";
export { DimensionMismatchError, EmbeddingIndex, cosineSimilarity } from "./domain/embedding-index";
export { HashEmbedder, hashEmbed } from "./domain/hash-embedder";
export type { IndexEntry, RelevanceQuery } from "./domain/retrieval";
export { DEFAULT_MAX_WORKING, buildIndex, retrieveRelevant } from "./domain/retrieval";

export type { VectoredMemory } from "./domain/consolidate";
export { planConsolidation } from "./domain/consolidate";

export type {
  LoadMemoryOptions,
  LoadedMemory,
  MemoryAddresses,
  MemoryOps,
  MemorySource,
  MemoryWriter,
  SaveResult,
} from "./application/memory";
export { loadMemory, saveMemory } from "./application/memory";

export type { Author } from "./domain/author";
export { AUTHORS, authorOf, kindOf } from "./domain/author";

export type { Account, FromMnemonicOptions, Signer, SigningKey, WalletOptions } from "./infrastructure/ecash/wallet";
export {
  InvalidEntropyError,
  Wallet,
  XEC_COIN_TYPE,
  derivationPath,
  generateMnemonic,
} from "./infrastructure/ecash/wallet";

export type { Env } from "./infrastructure/ecash/keyring";
export {
  ENV_MNEMONIC,
  ENV_NETWORK,
  ENV_PASSPHRASE,
  InvalidNetworkError,
  MissingMnemonicError,
  loadWallet,
} from "./infrastructure/ecash/keyring";

export type { FundingCoin, FundingPolicy, FundingStatus } from "./domain/funding";
export { assessFunding } from "./domain/funding";

export type { Network, NetworkConfig, NetworkOverrides } from "./infrastructure/ecash/network";
export { DEFAULT_NETWORK, networkConfig } from "./infrastructure/ecash/network";

export type {
  AwaitFundingOptions,
  Clock,
  UtxoSource,
} from "./infrastructure/ecash/chronik";
export { ChronikGateway, FundingTimeoutError, systemClock } from "./infrastructure/ecash/chronik";

export type {
  Broadcaster,
  CoinSource,
  MinterOptions,
  MintResult,
  SpendableCoin,
  SpendResult,
} from "./infrastructure/ecash/minter";
export {
  InsufficientFundsError,
  MEMO_COIN_VOUT,
  MemoCoinNotFoundError,
  Minter,
  OP_RETURN_VOUT,
} from "./infrastructure/ecash/minter";

export type { LiveCoin, MemoCoinSource, UnspentCoin } from "./infrastructure/ecash/reader";
export { MemoReader } from "./infrastructure/ecash/reader";

export { decodeMemo, encodeMemo, isMemoScript } from "./infrastructure/ecash/memo-codec";
export {
  DUST_SATS,
  LOKAD_ID,
  MAX_MEMORY_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_POINTER_CHUNKS,
  PROTOCOL_VERSION,
  TXID_BYTES,
} from "./infrastructure/ecash/protocol";
export {
  MalformedMemoError,
  MemoCodecError,
  MemoTooLargeError,
  UnsupportedVersionError,
} from "./infrastructure/ecash/errors";
