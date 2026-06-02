import { beforeAll, describe, expect, test } from "bun:test";
import { Address, Script, fromHex } from "ecash-lib";
import {
  DUST_SATS,
  type MemoCoinSource,
  MemoReader,
  type UnspentCoin,
  encodeMemo,
  memory,
  pin,
  pointer,
  text,
  Wallet,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let OWNER: Script;

beforeAll(() => {
  const signer = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" }).signer("agent");
  OWNER = Address.fromCashAddress(signer.address).toScript();
});

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
