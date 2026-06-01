import { describe, expect, test } from "bun:test";
import {
  ChronikGateway,
  FundingTimeoutError,
  type Clock,
  type UtxoSource,
} from "../src/index";

type FakeUtxo = { sats: bigint; blockHeight: number };

/** A UtxoSource that returns a scripted sequence of UTXO sets, one per poll. */
function fakeSource(snapshots: FakeUtxo[][]): { source: UtxoSource; calls: () => number } {
  let call = 0;
  const source: UtxoSource = {
    address: () => ({
      utxos: async () => {
        const snapshot = snapshots[Math.min(call, snapshots.length - 1)]!;
        call++;
        return { utxos: snapshot };
      },
    }),
  };
  return { source, calls: () => call };
}

/** A clock whose time only advances when something sleeps. */
function fakeClock(): Clock {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

const ADDR = "ectest:qexample";

describe("ChronikGateway.coins", () => {
  test("maps sats and treats mempool height (-1) as unconfirmed", async () => {
    const { source } = fakeSource([
      [
        { sats: 1000n, blockHeight: 800000 },
        { sats: 546n, blockHeight: -1 },
      ],
    ]);
    const coins = await new ChronikGateway(source).coins(ADDR);
    expect(coins).toEqual([
      { sats: 1000n, confirmed: true },
      { sats: 546n, confirmed: false },
    ]);
  });
});

describe("ChronikGateway.awaitFunding", () => {
  test("returns as soon as the address is funded", async () => {
    const { source, calls } = fakeSource([[{ sats: 5000n, blockHeight: 800000 }]]);
    const status = await new ChronikGateway(source).awaitFunding(
      ADDR,
      { minimumSats: 546n },
      { clock: fakeClock() },
    );
    expect(status.funded).toBe(true);
    expect(status.totalSats).toBe(5000n);
    expect(calls()).toBe(1);
  });

  test("polls until the funds arrive", async () => {
    const { source, calls } = fakeSource([
      [],
      [{ sats: 200n, blockHeight: -1 }],
      [{ sats: 600n, blockHeight: 801000 }],
    ]);
    const status = await new ChronikGateway(source).awaitFunding(
      ADDR,
      { minimumSats: 546n },
      { pollIntervalMs: 1000, clock: fakeClock() },
    );
    expect(status.funded).toBe(true);
    expect(calls()).toBe(3);
  });

  test("throws FundingTimeoutError when the deadline passes unfunded", async () => {
    const { source } = fakeSource([[]]);
    const gateway = new ChronikGateway(source);
    const promise = gateway.awaitFunding(
      ADDR,
      { minimumSats: 546n },
      { pollIntervalMs: 1000, timeoutMs: 2500, clock: fakeClock() },
    );
    await expect(promise).rejects.toBeInstanceOf(FundingTimeoutError);
  });

  test("honors an already-aborted signal", async () => {
    const { source } = fakeSource([[]]);
    const promise = new ChronikGateway(source).awaitFunding(
      ADDR,
      { minimumSats: 546n },
      { signal: AbortSignal.abort(), clock: fakeClock() },
    );
    await expect(promise).rejects.toThrow();
  });
});
