/**
 * Funding is the precondition for writing: before the agent can mint a memory
 * coin, its memory address must hold enough spendable XEC to cover the coin's
 * dust plus the transaction fee. This module decides, in chain-agnostic terms,
 * whether an address is funded — given only a list of its spendable amounts.
 */

/** One spendable output backing an address, reduced to what funding cares about. */
export interface FundingCoin {
  readonly sats: bigint;
  /** False while the output is still unconfirmed in the mempool. */
  readonly confirmed: boolean;
}

/** When does an address count as funded. */
export interface FundingPolicy {
  /** Minimum spendable sats required before the address is considered funded. */
  readonly minimumSats: bigint;
  /** When true, only confirmed coins count toward the minimum. Default false. */
  readonly requireConfirmed?: boolean;
}

/** A spendable-balance summary for an address against a {@link FundingPolicy}. */
export interface FundingStatus {
  readonly confirmedSats: bigint;
  readonly unconfirmedSats: bigint;
  readonly totalSats: bigint;
  readonly coinCount: number;
  readonly funded: boolean;
}

const sumSats = (coins: readonly FundingCoin[]): bigint =>
  coins.reduce((total, coin) => total + coin.sats, 0n);

export function assessFunding(
  coins: readonly FundingCoin[],
  policy: FundingPolicy,
): FundingStatus {
  const confirmedSats = sumSats(coins.filter((coin) => coin.confirmed));
  const totalSats = sumSats(coins);
  const available = policy.requireConfirmed ? confirmedSats : totalSats;
  return {
    confirmedSats,
    unconfirmedSats: totalSats - confirmedSats,
    totalSats,
    coinCount: coins.length,
    funded: available >= policy.minimumSats,
  };
}
