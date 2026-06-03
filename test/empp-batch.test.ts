import { beforeAll, describe, expect, test } from "bun:test";
import { Address, Script, Tx, emppScript, isPushOp, strToBytes } from "ecash-lib";
import {
  type Broadcaster,
  type CoinSource,
  DUST_SATS,
  type MemoCoinSource,
  MemoReader,
  MemoTooLargeError,
  Minter,
  type Signer,
  type SpendableCoin,
  type UnspentCoin,
  Wallet,
  batchMemos,
  decodeMemo,
  decodeMemoBatch,
  encodeMemo,
  encodeMemoBatch,
  memory,
  text,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let SIGNER: Signer;
let OWNER: Script;

beforeAll(() => {
  SIGNER = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" }).signer("agent");
  OWNER = Address.fromCashAddress(SIGNER.address).toScript();
});

const notes = (...texts: string[]) => texts.map((t) => memory(text(t)));

describe("eMPP batch codec (AMP-240)", () => {
  test("round-trips several memos in section order", () => {
    const memos = notes("first note", "second note", "third note");
    expect(decodeMemoBatch(encodeMemoBatch(memos))).toEqual(memos);
  });

  test("round-trips a single-section batch", () => {
    const memos = notes("alone");
    expect(decodeMemoBatch(encodeMemoBatch(memos))).toEqual(memos);
  });

  test("a single (non-eMPP) memo script is not a batch", () => {
    expect(decodeMemoBatch(encodeMemo(memory(text("plain single"))))).toBeNull();
  });

  test("a batch script is not mistaken for a single memo", () => {
    expect(decodeMemo(encodeMemoBatch(notes("a", "b")))).toBeNull();
  });

  test("skips foreign eMPP sections and keeps the Bettyjane ones", () => {
    const foreign = strToBytes("SLP2hello"); // a different protocol's LOKAD
    const mixed = emppScript([foreign, sectionBytesOf("ours")]);
    expect(decodeMemoBatch(mixed)).toEqual(notes("ours"));
  });

  test("rejects an empty batch", () => {
    expect(() => encodeMemoBatch([])).toThrow();
  });

  test("throws when sections overflow one OP_RETURN", () => {
    const big = notes("x".repeat(100), "y".repeat(100), "z".repeat(100));
    expect(() => encodeMemoBatch(big)).toThrow(MemoTooLargeError);
  });
});

describe("batchMemos packing", () => {
  test("keeps memos that fit in a single batch", () => {
    const memos = notes("a", "b", "c");
    expect(batchMemos(memos)).toHaveLength(1);
  });

  test("splits memos that overflow across batches, preserving order", () => {
    const memos = notes("x".repeat(100), "y".repeat(100), "z".repeat(100));
    const batches = batchMemos(memos);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(memos);
  });
});

/** Build one Bettyjane eMPP section's bytes for a memory text, via the encoder. */
function sectionBytesOf(t: string): Uint8Array {
  // Parse a one-memo batch back into its single section's bytes.
  const ops = encodeMemoBatch(notes(t)).ops();
  ops.next(); // OP_RETURN
  ops.next(); // OP_RESERVED
  const push = ops.next();
  if (push === undefined || !isPushOp(push)) throw new Error("no section");
  return push.data;
}

function harness(coins: SpendableCoin[]): { minter: Minter; broadcasts: Uint8Array[] } {
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

const coin = (sats: bigint, outIdx = 0): SpendableCoin => ({
  outpoint: { txid: "11".repeat(32), outIdx },
  sats,
});

describe("Minter.mintBatch (AMP-240)", () => {
  test("lays one dust coin per memo after a single eMPP OP_RETURN", async () => {
    const { minter, broadcasts } = harness([coin(100_000n)]);
    const memos = notes("note one", "note two", "note three");

    const result = await minter.mintBatch(memos, SIGNER);

    expect(broadcasts).toHaveLength(1);
    const tx = Tx.deser(result.rawTx);
    expect(decodeMemoBatch(tx.outputs[0]!.script)).toEqual(memos);
    // outputs: OP_RETURN + 3 dust coins + change
    for (let i = 1; i <= 3; i++) {
      expect(tx.outputs[i]!.sats).toBe(DUST_SATS);
      expect(tx.outputs[i]!.script.bytecode).toEqual(OWNER.bytecode);
    }
    expect(tx.outputs[4]!.sats).toBeGreaterThan(DUST_SATS); // change
  });
});

describe("Minter.rememberBatch (AMP-240)", () => {
  test("packs many notes into fewer transactions than notes", async () => {
    const { minter, broadcasts } = harness([coin(1_000_000n)]);
    const values = ["x".repeat(100), "y".repeat(100), "z".repeat(100)];

    const results = await minter.rememberBatch(values, SIGNER);

    expect(broadcasts.length).toBeLessThan(values.length);
    expect(results.flatMap((r) => r.memos.map((m) => (m.content.type === "text" ? m.content.text : "")))).toEqual(
      values,
    );
  });
});

/** A fake reader source over fixed utxos and tx output scripts. */
function source(utxos: UnspentCoin[], txs: Record<string, Script[]>): MemoCoinSource {
  return {
    utxos: async () => utxos,
    outputScripts: async (txid) => txs[txid] ?? [],
  };
}

describe("MemoReader over a batched transaction (AMP-240)", () => {
  test("surfaces one memory per section, mapped by output index", async () => {
    const memos = notes("section zero", "section one", "section two");
    const TX = "ab".repeat(32);
    const batchScript = encodeMemoBatch(memos);
    // OP_RETURN at 0, dust coins at 1..3, change at 4.
    const scripts = [batchScript, OWNER, OWNER, OWNER, OWNER];
    const utxos: UnspentCoin[] = [1, 2, 3].map((outIdx) => ({
      outpoint: { txid: TX, outIdx },
      sats: DUST_SATS,
      blockHeight: 100,
    }));

    const coins = await new MemoReader(source(utxos, { [TX]: scripts })).listLiveCoins("ectest:q");

    const byVout = Object.fromEntries(coins.map((c) => [c.outpoint.outIdx, c]));
    expect(coins).toHaveLength(3);
    expect(byVout[1]!.memo).toEqual(memos[0]!);
    expect(byVout[2]!.memo).toEqual(memos[1]!);
    expect(byVout[3]!.memo).toEqual(memos[2]!);
    expect(coins.every((c) => c.authorVerified === false)).toBe(true);
  });
});
