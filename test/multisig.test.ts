import { beforeAll, describe, expect, test } from "bun:test";
import { Script, Tx, shaRmd160, toHex } from "ecash-lib";
import {
  type Broadcaster,
  type CoinSource,
  ConsensusMinter,
  type ConsensusSigner,
  DUST_SATS,
  OP_RETURN_VOUT,
  MEMO_COIN_VOUT,
  Wallet,
  consensus,
  consensusAddress,
  consensusRedeemScript,
  decodeMemo,
  encodeMemo,
  text,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let signers: ConsensusSigner[];
let agentPk: Uint8Array;
let humanPk: Uint8Array;

beforeAll(() => {
  const wallet = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" });
  const agent = wallet.signer("agent");
  const human = wallet.signer("human");
  agentPk = agent.pubkey;
  humanPk = human.pubkey;
  signers = [
    { pubkey: agent.pubkey, seckey: agent.seckey },
    { pubkey: human.pubkey, seckey: human.seckey },
  ];
});

describe("2-of-2 redeem script and address (AMP-244)", () => {
  test("the redeem script is independent of pubkey order", () => {
    const a = consensusRedeemScript([agentPk, humanPk]);
    const b = consensusRedeemScript([humanPk, agentPk]);
    expect(toHex(a.bytecode)).toBe(toHex(b.bytecode));
  });

  test("the address is a deterministic P2SH cashaddr", () => {
    const addr = consensusAddress([agentPk, humanPk], "ectest");
    expect(addr).toBe(consensusAddress([humanPk, agentPk], "ectest"));
    expect(addr.startsWith("ectest:p")).toBe(true); // P2SH addresses use the 'p' type
  });

  test("requires exactly two pubkeys", () => {
    expect(() => consensusRedeemScript([agentPk])).toThrow();
  });
});

function harness(coins: { outpoint: { txid: string; outIdx: number }; sats: bigint }[]): {
  minter: ConsensusMinter;
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
  return { minter: new ConsensusMinter(source, broadcaster), broadcasts };
}

describe("ConsensusMinter.mint (AMP-244)", () => {
  test("lays a consensus memo and a dust coin at the 2-of-2 P2SH address", async () => {
    const { minter, broadcasts } = harness([{ outpoint: { txid: "11".repeat(32), outIdx: 0 }, sats: 100_000n }]);

    const result = await minter.mint(consensus(text("the team has ratified this")), signers, "ectest");

    expect(broadcasts).toHaveLength(1);
    const tx = Tx.deser(result.rawTx);
    expect(decodeMemo(tx.outputs[OP_RETURN_VOUT]!.script)).toEqual(consensus(text("the team has ratified this")));

    const p2sh = Script.p2sh(shaRmd160(consensusRedeemScript([agentPk, humanPk]).bytecode));
    expect(tx.outputs[MEMO_COIN_VOUT]!.sats).toBe(DUST_SATS);
    expect(toHex(tx.outputs[MEMO_COIN_VOUT]!.script.bytecode)).toBe(toHex(p2sh.bytecode));
  });

  test("the input is spent with a 2-of-2 scriptSig carrying both signatures and the redeem script", async () => {
    const { minter, broadcasts } = harness([{ outpoint: { txid: "11".repeat(32), outIdx: 0 }, sats: 100_000n }]);
    await minter.mint(consensus(text("ratified")), signers, "ectest");

    const input = Tx.deser(broadcasts[0]!).inputs[0]!;
    const redeemHex = toHex(consensusRedeemScript([agentPk, humanPk]).bytecode);
    const scriptSigHex = toHex(input.script!.bytecode);
    // The P2SH scriptSig ends with the redeem script push; OP_0 + two signatures precede it.
    expect(scriptSigHex.includes(redeemHex)).toBe(true);
    expect(input.script!.bytecode.length).toBeGreaterThan(consensusRedeemScript([agentPk, humanPk]).bytecode.length + 64);
  });
});

describe("consensus memo codec", () => {
  test("a consensus memo round-trips through the codec", () => {
    const memo = consensus(text("co-signed truth"));
    expect(decodeMemo(encodeMemo(memo))).toEqual(memo);
  });
});
