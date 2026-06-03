import { beforeAll, describe, expect, test } from "bun:test";
import { Address, Ecc, Script, fromHex } from "ecash-lib";
import {
  type AddressTx,
  DUST_SATS,
  type MemoCoinSource,
  MemoReader,
  type Signer,
  type UnspentCoin,
  encodeMemo,
  encodeSignedMemo,
  memory,
  pin,
  pointer,
  signingDigest,
  text,
  Wallet,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let OWNER: Script;
let SIGNER: Signer;
let ECC: Ecc;

beforeAll(() => {
  SIGNER = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" }).signer("agent");
  OWNER = Address.fromCashAddress(SIGNER.address).toScript();
  ECC = new Ecc();
});

/** A v2 memo script signed by the test's own (agent) key, as the minter would mint it. */
function signed(memoText: string): Script {
  const memo = memory(text(memoText));
  return encodeSignedMemo(memo, ECC.signRecoverable(SIGNER.seckey, signingDigest(memo)));
}

const ADDRESS = "ectest:qqfoobar";

function utxo(txid: string, sats: bigint, blockHeight = 100, outIdx = 1): UnspentCoin {
  return { outpoint: { txid, outIdx }, sats, blockHeight };
}

/** A fake source over fixed utxos and tx output scripts; records which txs it reads. */
function source(
  utxos: UnspentCoin[],
  txs: Record<string, Script[]>,
): { src: MemoCoinSource; fetched: string[] } {
  const fetched: string[] = [];
  const src: MemoCoinSource = {
    utxos: async () => utxos,
    outputScripts: async (txid) => {
      fetched.push(txid);
      const scripts = txs[txid];
      if (!scripts) throw new Error(`unexpected tx fetch: ${txid}`);
      return scripts;
    },
  };
  return { src, fetched };
}

const AA = "aa".repeat(32);
const BB = "bb".repeat(32);
const CC = "cc".repeat(32);
const DD = "dd".repeat(32);

function pointerBytes(...txids: string[]): Uint8Array {
  const out = new Uint8Array(txids.length * 32);
  txids.forEach((txid, i) => out.set(fromHex(txid), i * 32));
  return out;
}

describe("MemoReader.listLiveCoins", () => {
  test("returns the decoded memo for each live dust coin", async () => {
    const memo = memory(text("recall: the spec lives in docs/"));
    const { src } = source([utxo(AA, DUST_SATS)], { [AA]: [encodeMemo(memo), OWNER] });

    const coins = await new MemoReader(src).listLiveCoins(ADDRESS);

    expect(coins).toHaveLength(1);
    expect(coins[0]!.memo).toEqual(memo);
    expect(coins[0]!.outpoint).toEqual({ txid: AA, outIdx: 1 });
    expect(coins[0]!.sats).toBe(DUST_SATS);
    expect(coins[0]!.blockHeight).toBe(100);
    expect(coins[0]!.confirmed).toBe(true);
  });

  test("marks a signed coin authorVerified and an unsigned coin not (AMP-239)", async () => {
    const { src } = source([utxo(AA, DUST_SATS), utxo(BB, DUST_SATS)], {
      [AA]: [signed("a signed memory"), OWNER],
      [BB]: [encodeMemo(memory(text("an unsigned memory"))), OWNER],
    });

    const coins = await new MemoReader(src, ECC).listLiveCoins(ADDRESS);
    const byTxid = Object.fromEntries(coins.map((c) => [c.outpoint.txid, c]));

    expect(byTxid[AA]!.authorVerified).toBe(true);
    expect(byTxid[BB]!.authorVerified).toBe(false);
  });

  test("verifies many signed coins read concurrently without wasm aliasing", async () => {
    const txids = ["1a", "2b", "3c", "4d", "5e"].map((p) => p.repeat(32));
    const utxos = txids.map((t) => utxo(t, DUST_SATS));
    const txs = Object.fromEntries(txids.map((t, i) => [t, [signed(`memory ${i}`), OWNER]]));

    const coins = await new MemoReader(source(utxos, txs).src, ECC).listLiveCoins(ADDRESS);

    expect(coins).toHaveLength(txids.length);
    expect(coins.every((c) => c.authorVerified)).toBe(true);
  });

  test("skips funding and change coins without fetching their tx", async () => {
    const memo = pin(text("name: Bettyjane"));
    const { src, fetched } = source([utxo(AA, DUST_SATS), utxo(BB, 10_000n)], {
      [AA]: [encodeMemo(memo), OWNER],
    });

    const coins = await new MemoReader(src).listLiveCoins(ADDRESS);

    expect(coins).toHaveLength(1);
    expect(fetched).toEqual([AA]);
  });

  test("skips dust coins whose tx carries no Bettyjane memo", async () => {
    const { src } = source([utxo(CC, DUST_SATS)], { [CC]: [OWNER] });

    const coins = await new MemoReader(src).listLiveCoins(ADDRESS);

    expect(coins).toEqual([]);
  });

  test("finds the memo wherever the OP_RETURN sits among the outputs", async () => {
    const memo = memory(text("recall: out of order"));
    const { src } = source([utxo(AA, DUST_SATS)], { [AA]: [OWNER, encodeMemo(memo), OWNER] });

    const coins = await new MemoReader(src).listLiveCoins(ADDRESS);

    expect(coins[0]!.memo).toEqual(memo);
  });

  test("marks an unconfirmed mempool coin as not confirmed", async () => {
    const memo = memory(text("recall: just minted"));
    const { src } = source([utxo(AA, DUST_SATS, -1)], { [AA]: [encodeMemo(memo), OWNER] });

    const coins = await new MemoReader(src).listLiveCoins(ADDRESS);

    expect(coins[0]!.confirmed).toBe(false);
  });

  test("returns an empty list for an address with no coins", async () => {
    const { src } = source([], {});

    expect(await new MemoReader(src).listLiveCoins(ADDRESS)).toEqual([]);
  });
});

describe("MemoReader.resolveText", () => {
  test("returns the text of an inline memory directly", async () => {
    const { src, fetched } = source([utxo(AA, DUST_SATS)], {
      [AA]: [encodeMemo(memory(text("inline note"))), OWNER],
    });
    const reader = new MemoReader(src);
    const [coin] = await reader.listLiveCoins(ADDRESS);

    expect(await reader.resolveText(coin!)).toBe("inline note");
    expect(fetched).toEqual([AA]); // only the coin's own tx; no chunk fetches
  });

  test("rejoins a pointer memory's chunk txs in order", async () => {
    const { src, fetched } = source([utxo(DD, DUST_SATS)], {
      [DD]: [encodeMemo(memory(pointer(pointerBytes(AA, BB)))), OWNER],
      [AA]: [encodeMemo(memory(text("Hello, "))), OWNER],
      [BB]: [encodeMemo(memory(text("world"))), OWNER],
    });
    const reader = new MemoReader(src);
    const [coin] = await reader.listLiveCoins(ADDRESS);

    expect(await reader.resolveText(coin!)).toBe("Hello, world");
    expect(fetched).toContain(AA);
    expect(fetched).toContain(BB);
  });

  test("throws when a pointer payload is not a whole number of txids", async () => {
    const { src } = source([utxo(DD, DUST_SATS)], {
      [DD]: [encodeMemo(memory(pointer(new Uint8Array(20)))), OWNER],
    });
    const reader = new MemoReader(src);
    const [coin] = await reader.listLiveCoins(ADDRESS);

    await expect(reader.resolveText(coin!)).rejects.toThrow();
  });
});

/** A memo tx for the history source: OP_RETURN + a dust memo coin, optionally spent. */
function memoTx(txid: string, value: string, spent: boolean): AddressTx {
  return {
    txid,
    blockHeight: 100,
    outputs: [
      { script: encodeMemo(memory(text(value))), sats: 0n, spent: false },
      { script: OWNER, sats: DUST_SATS, spent },
    ],
  };
}

describe("MemoReader.listAllCoins (history)", () => {
  function historySource(txs: AddressTx[]): MemoCoinSource {
    return {
      utxos: async () => [],
      outputScripts: async () => [],
      history: async () => txs,
    };
  }

  test("returns every memory ever minted, flagging the spent ones", async () => {
    const reader = new MemoReader(
      historySource([memoTx(AA, "still live", false), memoTx(BB, "forgotten one", true)]),
    );

    const coins = await reader.listAllCoins(ADDRESS);
    const byTxid = Object.fromEntries(coins.map((c) => [c.outpoint.txid, c]));

    expect(coins).toHaveLength(2);
    expect(byTxid[AA]!.spent).toBe(false);
    expect(byTxid[AA]!.memo.content).toEqual({ type: "text", text: "still live" });
    expect(byTxid[BB]!.spent).toBe(true);
    expect(byTxid[BB]!.memo.content).toEqual({ type: "text", text: "forgotten one" });
  });

  test("ignores non-memo dust and foreign transactions", async () => {
    const foreign: AddressTx = {
      txid: CC,
      blockHeight: 100,
      outputs: [{ script: OWNER, sats: DUST_SATS, spent: false }], // a plain dust coin, no memo
    };
    const reader = new MemoReader(historySource([memoTx(AA, "real", false), foreign]));

    const coins = await reader.listAllCoins(ADDRESS);
    expect(coins).toHaveLength(1);
    expect(coins[0]!.outpoint.txid).toBe(AA);
  });

  test("throws when the source has no history support", async () => {
    const { src } = source([], {});
    await expect(new MemoReader(src).listAllCoins(ADDRESS)).rejects.toThrow();
  });
});
