/** A coin id is a memory's outpoint in textual form, `txid:outIdx`. */

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

export function coinId(outpoint: Outpoint): string {
  return `${outpoint.txid}:${outpoint.outIdx}`;
}

/** Parse a coin id back into an outpoint; the txid is lowercased. */
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
