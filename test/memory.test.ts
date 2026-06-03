import { describe, expect, test } from "bun:test";
import {
  type LiveCoin,
  type MemorySource,
  type MemoryWriter,
  type Signer,
  loadMemory,
  memory,
  saveMemory,
  text,
} from "../src/index";

function coin(txid: string, value: string): LiveCoin {
  return {
    outpoint: { txid, outIdx: 1 },
    sats: 546n,
    memo: memory(text(value)),
    blockHeight: 100,
    confirmed: true,
    authorVerified: false,
  };
}

function fakeSource(byAddress: Record<string, LiveCoin[]>): MemorySource {
  return {
    listLiveCoins: async (address) => byAddress[address] ?? [],
    resolveText: async (c) => (c.memo.content.type === "text" ? c.memo.content.text : "<pointer>"),
  };
}

const PINS = "ecash:pin";
const MEM = "ecash:mem";

describe("loadMemory", () => {
  test("returns the pins and the working-set memories as text", async () => {
    const source = fakeSource({
      [PINS]: [coin("aa", "name: Bettyjane")],
      [MEM]: [coin("bb", "deploys run from CI"), coin("cc", "prefer bun")],
    });

    const loaded = await loadMemory(source, { pin: PINS, memory: MEM });

    expect(loaded.pins).toEqual(["name: Bettyjane"]);
    expect(loaded.memories).toEqual([
      { id: "bb:1", text: "deploys run from CI" },
      { id: "cc:1", text: "prefer bun" },
    ]);
  });

  test("caps the working set at maxWorking", async () => {
    const source = fakeSource({
      [PINS]: [],
      [MEM]: [coin("a", "one"), coin("b", "two"), coin("c", "three")],
    });

    const loaded = await loadMemory(source, { pin: PINS, memory: MEM }, { maxWorking: 2 });

    expect(loaded.memories.map((m) => m.text)).toEqual(["one", "two"]);
  });
});

describe("saveMemory", () => {
  const signer = {} as unknown as Signer;

  function fakeWriter() {
    const remembered: string[] = [];
    const forgot: string[] = [];
    const writer: MemoryWriter = {
      remember: async (value) => {
        remembered.push(value);
        return { txid: `t-${value}`, rawTx: new Uint8Array(), memo: memory(text(value)) };
      },
      forget: async (id) => {
        forgot.push(id);
        return { txid: `f-${id}`, rawTx: new Uint8Array(), outpoint: { txid: id, outIdx: 1 } };
      },
    };
    return { writer, remembered, forgot };
  }

  test("mints each remembered note and forgets each named coin", async () => {
    const { writer, remembered, forgot } = fakeWriter();

    const result = await saveMemory(writer, signer, {
      remember: ["learned X", "decided Y"],
      forget: ["dead:1"],
    });

    expect(remembered).toEqual(["learned X", "decided Y"]);
    expect(forgot).toEqual(["dead:1"]);
    expect(result.minted).toHaveLength(2);
    expect(result.forgot).toHaveLength(1);
  });

  test("does nothing for empty ops", async () => {
    const { writer, remembered, forgot } = fakeWriter();

    const result = await saveMemory(writer, signer, {});

    expect(remembered).toEqual([]);
    expect(forgot).toEqual([]);
    expect(result).toEqual({ minted: [], forgot: [] });
  });
});
