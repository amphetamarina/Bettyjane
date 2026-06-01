import { describe, expect, test } from "bun:test";
import { assessFunding, type FundingCoin } from "../src/index";

const coin = (sats: bigint, confirmed = true): FundingCoin => ({ sats, confirmed });

describe("assessFunding", () => {
  test("sums confirmed and unconfirmed coins separately", () => {
    const status = assessFunding([coin(1000n), coin(500n, false), coin(46n)], {
      minimumSats: 0n,
    });
    expect(status.confirmedSats).toBe(1046n);
    expect(status.unconfirmedSats).toBe(500n);
    expect(status.totalSats).toBe(1546n);
    expect(status.coinCount).toBe(3);
  });

  test("an empty address is unfunded against any positive minimum", () => {
    const status = assessFunding([], { minimumSats: 1n });
    expect(status.totalSats).toBe(0n);
    expect(status.funded).toBe(false);
  });

  test("funded once total reaches the minimum", () => {
    expect(assessFunding([coin(545n)], { minimumSats: 546n }).funded).toBe(false);
    expect(assessFunding([coin(546n)], { minimumSats: 546n }).funded).toBe(true);
    expect(assessFunding([coin(300n), coin(300n)], { minimumSats: 546n }).funded).toBe(true);
  });

  test("requireConfirmed ignores mempool coins toward the minimum", () => {
    const coins = [coin(500n), coin(500n, false)];
    expect(assessFunding(coins, { minimumSats: 800n }).funded).toBe(true);
    expect(assessFunding(coins, { minimumSats: 800n, requireConfirmed: true }).funded).toBe(false);
    expect(assessFunding(coins, { minimumSats: 500n, requireConfirmed: true }).funded).toBe(true);
  });
});
