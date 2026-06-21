import { beforeAll, describe, expect, test } from "bun:test";
import { Address, Tx, toHex } from "ecash-lib";
import {
  type Broadcaster,
  type CoinSource,
  DUST_SATS,
  type Signer,
  type SpendableCoin,
  Wallet,
  changeThreadingMinter,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let SIGNER: Signer;

beforeAll(() => {
  SIGNER = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" }).signer("agent");
});

/**
 * A base source that always returns the SAME single funding coin, the worst
 * case the real Chronik creates when a just-spent coin has not propagated yet.
 * A naive minter would re-pick it every time and double-spend.
 */
function laggyBase(): { coins: CoinSource; broadcaster: Broadcaster; inputs: string[] } {
  const fixed: SpendableCoin = { outpoint: { txid: "aa".repeat(32), outIdx: 0 }, sats: 1_000_000n };
  const inputs: string[] = [];
  const coins: CoinSource = { spendableCoins: async () => [fixed] };
  const broadcaster: Broadcaster = {
    broadcast: async (rawTx) => {
      const tx = Tx.deser(rawTx);
      for (const input of tx.inputs) {
        const t = input.prevOut.txid;
        inputs.push((typeof t === "string" ? t : toHex(t)) + ":" + input.prevOut.outIdx);
      }
      return { txid: tx.txid() };
    },
  };
  return { coins, broadcaster, inputs };
}

describe("changeThreadingMinter (AMP-253 / mempool-conflict fix)", () => {
  test("consecutive mints spend distinct coins despite a stale source", async () => {
    const { coins, broadcaster, inputs } = laggyBase();
    const minter = changeThreadingMinter(coins, broadcaster);

    await minter.remember("note one", SIGNER);
    await minter.remember("note two", SIGNER);
    await minter.remember("note three", SIGNER);

    // Every transaction's input set is unique: no coin is spent twice, which is
    // exactly what avoids txn-mempool-conflict.
    expect(new Set(inputs).size).toBe(inputs.length);
    expect(inputs.length).toBe(3);
  });

  test("the second mint spends the first mint's change output", async () => {
    const { coins, broadcaster } = laggyBase();
    const owner = toHex(Address.fromCashAddress(SIGNER.address).toScript().bytecode);
    const txs: Uint8Array[] = [];
    const recording: Broadcaster = {
      broadcast: async (rawTx) => {
        txs.push(rawTx);
        return broadcaster.broadcast(rawTx);
      },
    };
    const minter = changeThreadingMinter(coins, recording);

    await minter.remember("first", SIGNER);
    await minter.remember("second", SIGNER);

    const first = Tx.deser(txs[0]!);
    const changeIdx = first.outputs.length - 1;
    expect(first.outputs[changeIdx]!.sats).toBeGreaterThan(DUST_SATS);
    expect(toHex(first.outputs[changeIdx]!.script.bytecode)).toBe(owner);

    // The second tx spends the first tx's change (its outIdx), not the original
    // funding coin (which sat at outIdx 0).
    const second = Tx.deser(txs[1]!);
    expect(second.inputs).toHaveLength(1);
    expect(second.inputs[0]!.prevOut.outIdx).toBe(changeIdx);
    expect(changeIdx).toBeGreaterThan(0);
  });
});
