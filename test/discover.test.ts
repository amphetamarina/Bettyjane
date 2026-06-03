import { beforeAll, describe, expect, test } from "bun:test";
import { Address, toHex } from "ecash-lib";
import {
  type Signer,
  Wallet,
  consensus,
  encodeMemo,
  encodeMemoBatch,
  encrypted,
  memory,
  pin,
  text,
} from "../src/index";
import { type DiscoverSource, type DiscoverTx, fetchDiscover } from "../explorer/discover";
import { parseDiscoverQuery } from "../api/discover";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const DUST = 546n;
let agentScriptHex: string;
let humanScriptHex: string;
let agentAddress: string;

beforeAll(() => {
  const wallet = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" });
  const agent: Signer = wallet.signer("agent");
  const human: Signer = wallet.signer("human");
  agentScriptHex = toHex(Address.fromCashAddress(agent.address).toScript().bytecode);
  humanScriptHex = toHex(Address.fromCashAddress(human.address).toScript().bytecode);
  agentAddress = agent.address;
});

/** Build a single-memo tx (OP_RETURN + a dust memo coin to ownerScriptHex). */
function memoTx(txid: string, script: ReturnType<typeof encodeMemo>, ownerHex: string, spent: boolean): DiscoverTx {
  return {
    txid,
    blockHeight: 100,
    outputs: [
      { scriptHex: toHex(script.bytecode), sats: 0n, spent: false },
      { scriptHex: ownerHex, sats: DUST, spent },
    ],
  };
}

function source(txs: DiscoverTx[]): DiscoverSource {
  return { lokadTxs: async () => txs };
}

describe("fetchDiscover (chain-wide pool)", () => {
  test("attributes each memory to the address that minted it", async () => {
    const { memories } = await fetchDiscover(
      "testnet",
      source([
        memoTx("a".repeat(64), encodeMemo(memory(text("an agent memory"))), agentScriptHex, false),
        memoTx("b".repeat(64), encodeMemo(pin(text("a human pin"))), humanScriptHex, true),
      ]),
    );

    expect(memories).toHaveLength(2);
    const byKind = Object.fromEntries(memories.map((m) => [m.kind, m]));
    expect(byKind.memory!.author).toBe("agent");
    expect(byKind.memory!.address).toBe(agentAddress);
    expect(byKind.memory!.spent).toBe(false);
    expect(byKind.pin!.author).toBe("human");
    expect(byKind.pin!.spent).toBe(true);
  });

  test("surfaces every section of a batched transaction", async () => {
    const memos = [memory(text("batch a")), memory(text("batch b"))];
    const batch = encodeMemoBatch(memos);
    const tx: DiscoverTx = {
      txid: "c".repeat(64),
      blockHeight: 100,
      outputs: [
        { scriptHex: toHex(batch.bytecode), sats: 0n, spent: false },
        { scriptHex: agentScriptHex, sats: DUST, spent: false },
        { scriptHex: agentScriptHex, sats: DUST, spent: false },
      ],
    };
    const { memories } = await fetchDiscover("testnet", source([tx]));
    expect(memories.map((m) => (m.content.type === "text" ? m.content.text : ""))).toEqual([
      "batch a",
      "batch b",
    ]);
  });

  test("marks encrypted memories without leaking bytes", async () => {
    const tx = memoTx(
      "d".repeat(64),
      encodeMemo(memory(encrypted(new Uint8Array([1, 2, 3, 4])))),
      agentScriptHex,
      false,
    );
    const { memories } = await fetchDiscover("testnet", source([tx]));
    expect(memories[0]!.content).toEqual({ type: "encrypted" });
  });

  test("skips transactions that carry no Bettyjane memo", async () => {
    const foreign: DiscoverTx = {
      txid: "e".repeat(64),
      blockHeight: 100,
      outputs: [{ scriptHex: agentScriptHex, sats: DUST, spent: false }], // dust, no OP_RETURN memo
    };
    const { memories } = await fetchDiscover("testnet", source([foreign]));
    expect(memories).toHaveLength(0);
  });
});

describe("parseDiscoverQuery", () => {
  test("defaults to mainnet and whitelists the network", () => {
    expect(parseDiscoverQuery({}).network).toBe("mainnet");
    expect(parseDiscoverQuery({ network: "testnet" }).network).toBe("testnet");
    expect(parseDiscoverQuery({ network: "bogus" }).network).toBe("mainnet");
  });
});
