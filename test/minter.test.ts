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

describe("Minter.mintData", () => {
  test("broadcasts an OP_RETURN-only tx with no dust memo coin", async () => {
    const { minter, broadcasts } = harness([coin(10_000n)]);

    const { rawTx } = await minter.mintData(memory(text("a chunk of text")), SIGNER);

    expect(broadcasts).toHaveLength(1);
    const outputs = Tx.deser(rawTx).outputs;
    expect(outputs).toHaveLength(2); // OP_RETURN + change, no dust coin
    expect(outputs[OP_RETURN_VOUT]!.sats).toBe(0n);
    expect(decodeMemo(outputs[OP_RETURN_VOUT]!.script)).toEqual(memory(text("a chunk of text")));
    expect(outputs[1]!.sats).toBeGreaterThan(DUST_SATS); // change, not a dust coin
  });
});

describe("Minter.remember with large content", () => {
  const longText = "x".repeat(500); // > MAX_PAYLOAD_BYTES (211): needs chunking

  test("splits into data-chunk txs plus a head pointer coin naming them", async () => {
    const { minter, broadcasts } = harness([coin(1_000_000n)]);

    const result = await minter.remember(longText, SIGNER);

    // 3 chunks of <=211 bytes for 500 bytes, then 1 head pointer tx.
    expect(broadcasts).toHaveLength(4);

    const chunkTxids: string[] = [];
    let rejoined = "";
    for (const raw of broadcasts.slice(0, 3)) {
      const tx = Tx.deser(raw);
      expect(tx.outputs).toHaveLength(2); // chunks carry no dust coin
      const memo = decodeMemo(tx.outputs[OP_RETURN_VOUT]!.script)!;
      expect(memo.content.type).toBe("text");
      if (memo.content.type === "text") rejoined += memo.content.text;
      chunkTxids.push(tx.txid());
    }
    expect(rejoined).toBe(longText);

    const head = Tx.deser(result.rawTx);
    expect(head.outputs[MEMO_COIN_VOUT]!.sats).toBe(DUST_SATS); // head is a real memory coin
    const headMemo = decodeMemo(head.outputs[OP_RETURN_VOUT]!.script)!;
    expect(headMemo.content.type).toBe("pointer");
    if (headMemo.content.type === "pointer") {
      expect(Buffer.from(headMemo.content.pointer).toString("hex")).toBe(chunkTxids.join(""));
    }
  });

  test("still mints a single inline text coin when the note fits", async () => {
    const { minter, broadcasts } = harness([coin(10_000n)]);

    const result = await minter.remember("short enough to fit inline", SIGNER);

    expect(broadcasts).toHaveLength(1);
    expect(result.memo).toEqual(memory(text("short enough to fit inline")));
  });
});

/** A CoinSource whose coins depend on the queried address, for cross-author tests. */
function addressAwareHarness(byAddress: Record<string, SpendableCoin[]>): { minter: Minter } {
  const source: CoinSource = { spendableCoins: async (address) => byAddress[address] ?? [] };
  const broadcaster: Broadcaster = {
    broadcast: async (rawTx) => ({ txid: Tx.deser(rawTx).txid() }),
  };
  return { minter: new Minter(source, broadcaster) };
}

describe("Minter.pin and unpin", () => {
  test("pin mints a pin-kind coin carrying the note", async () => {
    const { minter } = harness([coin(10_000n)]);

    const result = await minter.pin("standing: cite dates", SIGNER);

    expect(result.memo).toEqual(pin(text("standing: cite dates")));
    expect(decodeMemo(Tx.deser(result.rawTx).outputs[OP_RETURN_VOUT]!.script)).toEqual(
      pin(text("standing: cite dates")),
    );
  });

  test("unpin spends the named coin", async () => {
    const { minter, broadcasts } = harness([coin(10_000n, 0), coin(DUST_SATS, 1)]);

    const result = await minter.unpin(coinId(outpointAt(1)), SIGNER);

    expect(broadcasts).toHaveLength(1);
    expect(result.outpoint).toEqual(outpointAt(1));
  });
});

describe("signature permission (AMP-213)", () => {
  test("the agent key cannot spend a human pin", async () => {
    const wallet = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" });
    const human = wallet.signer("human");
    const agent = wallet.signer("agent");
    const pinOutpoint = { txid: "22".repeat(32), outIdx: 1 };
    const { minter } = addressAwareHarness({
      [human.address]: [
        { outpoint: pinOutpoint, sats: DUST_SATS },
        { outpoint: { txid: "22".repeat(32), outIdx: 0 }, sats: 10_000n },
      ],
      [agent.address]: [{ outpoint: { txid: "33".repeat(32), outIdx: 0 }, sats: 10_000n }],
    });

    // The agent's spend only consults the agent's own address, where the pin is absent.
    await expect(minter.forget(coinId(pinOutpoint), agent)).rejects.toBeInstanceOf(
      MemoCoinNotFoundError,
    );
    // The human, who holds the pin at their address, can drop it.
    await expect(minter.unpin(coinId(pinOutpoint), human)).resolves.toBeDefined();
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
