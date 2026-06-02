import { describe, expect, test } from "bun:test";
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
} from "../src/index";
import { Script, fromHex } from "ecash-lib";
import { fetchAddressMemories } from "../explorer/memories";
import { parseMemoriesQuery } from "../api/memories";

const OWNER = new Script(fromHex("6a"));
const ADDRESS = "ecash:qqexplorer";
const AA = "aa".repeat(32);
const BB = "bb".repeat(32);
const CC = "cc".repeat(32);
const DD = "dd".repeat(32);

function utxo(txid: string, sats: bigint, blockHeight = 100): UnspentCoin {
  return { outpoint: { txid, outIdx: 1 }, sats, blockHeight };
}

function reader(utxos: UnspentCoin[], txs: Record<string, Script[]>): MemoReader {
  const src: MemoCoinSource = {
    utxos: async () => utxos,
    outputScripts: async (txid) => {
      const scripts = txs[txid];
      if (!scripts) throw new Error(`unexpected tx fetch: ${txid}`);
      return scripts;
    },
  };
  return new MemoReader(src);
}

function pointerBytes(...txids: string[]): Uint8Array {
  const out = new Uint8Array(txids.length * 32);
  txids.forEach((txid, i) => out.set(fromHex(txid), i * 32));
  return out;
}

describe("fetchAddressMemories", () => {
  test("maps each live coin to a view and echoes address + network", async () => {
    const r = reader([utxo(AA, DUST_SATS)], {
      [AA]: [encodeMemo(pin(text("name: Bettyjane"))), OWNER],
    });

    const result = await fetchAddressMemories(ADDRESS, "mainnet", r);

    expect(result.address).toBe(ADDRESS);
    expect(result.network).toBe("mainnet");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]!.kind).toBe("pin");
    expect(result.memories[0]!.author).toBe("human");
    expect(result.memories[0]!.content).toEqual({
      type: "text",
      text: "name: Bettyjane",
      viaPointer: false,
    });
  });

  test("resolves a pointer memory to its full reassembled text", async () => {
    const r = reader([utxo(DD, DUST_SATS)], {
      [DD]: [encodeMemo(memory(pointer(pointerBytes(AA, BB)))), OWNER],
      [AA]: [encodeMemo(memory(text("Hello, "))), OWNER],
      [BB]: [encodeMemo(memory(text("world"))), OWNER],
    });

    const result = await fetchAddressMemories(ADDRESS, "mainnet", r);

    expect(result.memories[0]!.content).toEqual({
      type: "text",
      text: "Hello, world",
      viaPointer: true,
    });
  });

  test("falls back to the raw pointer hex when a chunk will not resolve", async () => {
    const r = reader([utxo(DD, DUST_SATS)], {
      [DD]: [encodeMemo(memory(pointer(pointerBytes(CC)))), OWNER],
      [CC]: [OWNER], // chunk tx carries no memo -> resolveText throws
    });

    const result = await fetchAddressMemories(ADDRESS, "mainnet", r);

    expect(result.memories[0]!.content).toEqual({
      type: "pointer",
      pointerHex: CC,
    });
  });

  test("orders memories latest first, with unconfirmed mempool coins ahead", async () => {
    const r = reader(
      [utxo(AA, DUST_SATS, 100), utxo(BB, DUST_SATS, 200), utxo(CC, DUST_SATS, -1)],
      {
        [AA]: [encodeMemo(memory(text("oldest"))), OWNER],
        [BB]: [encodeMemo(memory(text("middle"))), OWNER],
        [CC]: [encodeMemo(memory(text("newest, in mempool"))), OWNER],
      },
    );

    const result = await fetchAddressMemories(ADDRESS, "mainnet", r);

    expect(result.memories.map((m) => m.txid)).toEqual([CC, BB, AA]);
  });

  test("returns an empty list for an address with no memo coins", async () => {
    const result = await fetchAddressMemories(ADDRESS, "regtest", reader([], {}));
    expect(result.memories).toEqual([]);
  });
});

describe("parseMemoriesQuery", () => {
  test("reads the address and a whitelisted network", () => {
    expect(parseMemoriesQuery({ address: "ecash:qq", network: "testnet" })).toEqual({
      address: "ecash:qq",
      network: "testnet",
    });
  });

  test("defaults an unknown or missing network to mainnet", () => {
    expect(parseMemoriesQuery({ address: "ecash:qq" }).network).toBe("mainnet");
    expect(parseMemoriesQuery({ address: "ecash:qq", network: "bogus" }).network).toBe("mainnet");
  });

  test("coalesces a repeated param and trims whitespace", () => {
    expect(parseMemoriesQuery({ address: ["  ecash:first  ", "ecash:second"] }).address).toBe(
      "ecash:first",
    );
  });

  test("yields an empty address when none is given", () => {
    expect(parseMemoriesQuery({}).address).toBe("");
  });
});
