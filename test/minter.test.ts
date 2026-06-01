import { beforeAll, describe, expect, test } from "bun:test";
import { Address, Tx } from "ecash-lib";
import {
  type Broadcaster,
  type CoinSource,
  DUST_SATS,
  InsufficientFundsError,
  MEMO_COIN_VOUT,
  MemoCoinNotFoundError,
  Minter,
  OP_RETURN_VOUT,
  type Signer,
  type SpendableCoin,
  Wallet,
  coinId,
  decodeMemo,
  EmptyMemoError,
  InvalidCoinIdError,
  memory,
  pin,
  text,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// Derived in beforeAll: ecash-lib's wasm is not ready at module-eval time.
let SIGNER: Signer;
let OWNER_SCRIPT: Uint8Array;

beforeAll(() => {
  SIGNER = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" }).signer("human");
  OWNER_SCRIPT = Address.fromCashAddress(SIGNER.address).toScript().bytecode;
});

/** A coin at the signer's address, with a synthetic outpoint. */
function coin(sats: bigint, outIdx = 0): SpendableCoin {
  return { outpoint: { txid: "11".repeat(32), outIdx }, sats };
}

/** A CoinSource serving a fixed set, plus a Broadcaster that records the raw tx. */
function harness(coins: SpendableCoin[]): {
  minter: Minter;
  broadcasts: Uint8Array[];
} {
  const broadcasts: Uint8Array[] = [];
  const source: CoinSource = { spendableCoins: async () => coins };
  const broadcaster: Broadcaster = {
    broadcast: async (rawTx) => {
      broadcasts.push(rawTx);
      return { txid: Tx.deser(rawTx).txid() };
    },
  };
  return { minter: new Minter(source, broadcaster), broadcasts };
}

describe("Minter.mint", () => {
  test("broadcasts a tx whose OP_RETURN carries the memo", async () => {
    const { minter, broadcasts } = harness([coin(10_000n)]);
    const memo = pin(text("name: Bettyjane"));

    const result = await minter.mint(memo, SIGNER);

    expect(broadcasts).toHaveLength(1);
    const tx = Tx.deser(result.rawTx);
    expect(tx.txid()).toBe(result.txid);
    expect(decodeMemo(tx.outputs[OP_RETURN_VOUT]!.script)).toEqual(memo);
  });

  test("lays down a dust memo coin at the signer's own address", async () => {
    const { minter } = harness([coin(10_000n)]);
    const { rawTx } = await minter.mint(pin(text("goal: persist")), SIGNER);

    const memoCoin = Tx.deser(rawTx).outputs[MEMO_COIN_VOUT]!;
    expect(memoCoin.sats).toBe(DUST_SATS);
    expect(memoCoin.script.bytecode).toEqual(OWNER_SCRIPT);
  });

  test("returns change above dust to the signer", async () => {
    const { minter } = harness([coin(10_000n)]);
    const { rawTx } = await minter.mint(pin(text("standing: cite dates")), SIGNER);

    const change = Tx.deser(rawTx).outputs[2]!;
    expect(change.sats).toBeGreaterThan(DUST_SATS);
    expect(change.script.bytecode).toEqual(OWNER_SCRIPT);
  });

  test("spends funding coins but never the dust memo coins it already laid down", async () => {
    // One funding coin plus two existing memo coins (exactly dust): only the
    // funding coin may be consumed, so the signed tx has exactly one input.
    const { minter } = harness([coin(10_000n, 0), coin(DUST_SATS, 1), coin(DUST_SATS, 2)]);
    const { rawTx } = await minter.mint(pin(text("name: Bettyjane")), SIGNER);

    expect(Tx.deser(rawTx).inputs).toHaveLength(1);
  });

  test("throws when only dust memo coins are present", async () => {
    const { minter } = harness([coin(DUST_SATS, 0), coin(DUST_SATS, 1)]);
    await expect(minter.mint(pin(text("name")), SIGNER)).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
  });

  test("throws when the address holds no coins at all", async () => {
    const { minter } = harness([]);
    await expect(minter.mint(pin(text("name")), SIGNER)).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
  });
});

describe("Minter.remember", () => {
  test("mints a memory-kind coin carrying the given text", async () => {
    const { minter, broadcasts } = harness([coin(10_000n)]);

    const result = await minter.remember("deploys run from CI only", SIGNER);

    expect(broadcasts).toHaveLength(1);
    expect(result.memo).toEqual(memory(text("deploys run from CI only")));
    const tx = Tx.deser(result.rawTx);
    expect(decodeMemo(tx.outputs[OP_RETURN_VOUT]!.script)).toEqual(
      memory(text("deploys run from CI only")),
    );
  });

  test("lays down the memory as a dust coin at the signer's address", async () => {
    const { minter } = harness([coin(10_000n)]);

    const { rawTx } = await minter.remember("prefer bun over npm", SIGNER);

    const memoCoin = Tx.deser(rawTx).outputs[MEMO_COIN_VOUT]!;
    expect(memoCoin.sats).toBe(DUST_SATS);
    expect(memoCoin.script.bytecode).toEqual(OWNER_SCRIPT);
  });

  test("rejects empty text without broadcasting", async () => {
    const { minter, broadcasts } = harness([coin(10_000n)]);

    await expect(minter.remember("", SIGNER)).rejects.toBeInstanceOf(EmptyMemoError);
    expect(broadcasts).toHaveLength(0);
  });
});

describe("Minter.mintAll", () => {
  test("mints the initial pins in order, one broadcast each", async () => {
    const { minter, broadcasts } = harness([coin(100_000n)]);
    const pins = [pin(text("name: Bettyjane")), pin(text("goal: persist")), pin(text("standing: cite dates"))];

    const results = await minter.mintAll(pins, SIGNER);

    expect(broadcasts).toHaveLength(3);
    expect(results.map((r) => r.memo)).toEqual(pins);
    for (const result of results) {
      expect(decodeMemo(Tx.deser(result.rawTx).outputs[OP_RETURN_VOUT]!.script)).not.toBeNull();
    }
  });
});

/** The outpoint of a coin produced by {@link coin}, by output index. */
function outpointAt(outIdx: number): { txid: string; outIdx: number } {
  return { txid: "11".repeat(32), outIdx };
}

/** The input output-indices of a signed transaction, in order. */
function inputIndices(rawTx: Uint8Array): number[] {
  return Tx.deser(rawTx).inputs.map((input) => input.prevOut.outIdx);
}

describe("Minter.spend", () => {
  test("broadcasts a tx that consumes the targeted memo coin", async () => {
    const { minter, broadcasts } = harness([coin(10_000n, 0), coin(DUST_SATS, 1)]);

    const result = await minter.spend(outpointAt(1), SIGNER);

    expect(broadcasts).toHaveLength(1);
    expect(Tx.deser(result.rawTx).txid()).toBe(result.txid);
    expect(result.outpoint).toEqual(outpointAt(1));
    expect(inputIndices(result.rawTx)).toContain(1);
  });

  test("sweeps the reclaimed value back to the author's address", async () => {
    const { minter } = harness([coin(10_000n, 0), coin(DUST_SATS, 1)]);

    const { rawTx } = await minter.spend(outpointAt(1), SIGNER);
    const outputs = Tx.deser(rawTx).outputs;

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.sats).toBeGreaterThan(DUST_SATS);
    expect(outputs[0]!.script.bytecode).toEqual(OWNER_SCRIPT);
  });

  test("pulls in funding to pay the fee but leaves other memo coins untouched", async () => {
    const { minter } = harness([coin(10_000n, 0), coin(DUST_SATS, 1), coin(DUST_SATS, 2)]);

    const { rawTx } = await minter.spend(outpointAt(1), SIGNER);

    expect(inputIndices(rawTx).sort()).toEqual([0, 1]);
  });

  test("throws when no live coin sits at the given outpoint", async () => {
    const { minter } = harness([coin(10_000n, 0), coin(DUST_SATS, 1)]);

    await expect(minter.spend(outpointAt(9), SIGNER)).rejects.toBeInstanceOf(
      MemoCoinNotFoundError,
    );
  });

  test("throws when no funding coin can cover the fee to forget", async () => {
    const { minter } = harness([coin(DUST_SATS, 1)]);

    await expect(minter.spend(outpointAt(1), SIGNER)).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
  });
});

describe("Minter.forget", () => {
  test("forgets the coin named by its id, consuming exactly that coin", async () => {
    const { minter, broadcasts } = harness([coin(10_000n, 0), coin(DUST_SATS, 1)]);

    const result = await minter.forget(coinId(outpointAt(1)), SIGNER);

    expect(broadcasts).toHaveLength(1);
    expect(result.outpoint).toEqual(outpointAt(1));
    expect(inputIndices(result.rawTx)).toContain(1);
  });

  test("rejects a malformed id without broadcasting", async () => {
    const { minter, broadcasts } = harness([coin(10_000n, 0), coin(DUST_SATS, 1)]);

    await expect(minter.forget("not-a-coin-id", SIGNER)).rejects.toBeInstanceOf(
      InvalidCoinIdError,
    );
    expect(broadcasts).toHaveLength(0);
  });

  test("throws when the id names no live coin", async () => {
    const { minter } = harness([coin(10_000n, 0), coin(DUST_SATS, 1)]);

    await expect(minter.forget(coinId(outpointAt(9)), SIGNER)).rejects.toBeInstanceOf(
      MemoCoinNotFoundError,
    );
  });
});
