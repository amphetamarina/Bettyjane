/**
 * A coin id is the human- and agent-facing name for a memory: the outpoint of
 * its dust coin, written `txid:outIdx`. It is what {@link Minter.forget} takes
 * and what an agent copies from a minted or listed coin. Keeping the textual
 * form in one place means callers pass around a single string rather than an
 * outpoint pair, and every id is validated the same way before it reaches a key.
 */

export interface Outpoint {
  readonly txid: string;
  readonly outIdx: number;
}

const TXID_PATTERN = /^[0-9a-f]{64}$/;
const OUT_IDX_PATTERN = /^\d+$/;

/** Thrown when a string is not a well-formed `txid:outIdx` coin id. */
export class InvalidCoinIdError extends Error {
  constructor(readonly value: string) {
    super(`not a valid coin id: ${JSON.stringify(value)}`);
    this.name = "InvalidCoinIdError";
  }
}

/** The textual id of a coin: its txid and output index joined by a colon. */
export function coinId(outpoint: Outpoint): string {
  return `${outpoint.txid}:${outpoint.outIdx}`;
}

/** Parse a `txid:outIdx` id back into an outpoint, lowercasing the txid. */
export function parseCoinId(value: string): Outpoint {
  const separator = value.lastIndexOf(":");
  if (separator === -1) throw new InvalidCoinIdError(value);

  const txid = value.slice(0, separator).toLowerCase();
  const index = value.slice(separator + 1);
  if (!TXID_PATTERN.test(txid) || !OUT_IDX_PATTERN.test(index)) {
    throw new InvalidCoinIdError(value);
  }

  return { txid, outIdx: Number(index) };
}
