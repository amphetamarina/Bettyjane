import { beforeAll, describe, expect, test } from "bun:test";
import { Tx } from "ecash-lib";
import {
  type Broadcaster,
  type CoinSource,
  MemoTooLargeError,
  Minter,
  OP_RETURN_VOUT,
  type Signer,
  type SpendableCoin,
  Wallet,
  decryptWithSeckey,
  decodeMemo,
  encodeMemo,
  encrypted,
  memory,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let SIGNER: Signer;

beforeAll(() => {
  SIGNER = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" }).signer("agent");
});

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

const coin = (sats: bigint): SpendableCoin => ({ outpoint: { txid: "11".repeat(32), outIdx: 0 }, sats });

describe("encrypted memo codec (AMP-242)", () => {
  test("an encrypted content memo round-trips as opaque ciphertext", () => {
    const blob = Uint8Array.from({ length: 80 }, (_, i) => (i * 7) % 256);
    const memo = memory(encrypted(blob));
    const decoded = decodeMemo(encodeMemo(memo));
    expect(decoded?.content.type).toBe("encrypted");
    if (decoded?.content.type === "encrypted") {
      expect(Buffer.from(decoded.content.ciphertext).equals(Buffer.from(blob))).toBe(true);
    }
  });
});

describe("Minter.rememberPrivate (AMP-242)", () => {
  test("mints ciphertext on chain and never the plaintext", async () => {
    const { minter, broadcasts } = harness([coin(10_000n)]);
    const secret = "the API lives behind the staging gateway";

    const result = await minter.rememberPrivate(secret, SIGNER.pubkey, SIGNER);

    expect(result.memo.content.type).toBe("encrypted");
    const tx = Tx.deser(broadcasts[0]!);
    const opReturnHex = Buffer.from(tx.outputs[OP_RETURN_VOUT]!.script.bytecode).toString("utf8");
    expect(opReturnHex.includes(secret)).toBe(false); // plaintext is not on chain
  });

  test("the minted memory decrypts back to the original with the recipient key", async () => {
    const { minter } = harness([coin(10_000n)]);
    const secret = "remember to rotate the token monthly";

    const result = await minter.rememberPrivate(secret, SIGNER.pubkey, SIGNER);

    expect(result.memo.content.type).toBe("encrypted");
    if (result.memo.content.type === "encrypted") {
      const plain = new TextDecoder().decode(
        decryptWithSeckey(result.memo.content.ciphertext, SIGNER.seckey),
      );
      expect(plain).toBe(secret);
    }
  });

  test("rejects a note whose ciphertext would not fit one inline payload", async () => {
    const { minter } = harness([coin(10_000n)]);
    await expect(minter.rememberPrivate("x".repeat(300), SIGNER.pubkey, SIGNER)).rejects.toBeInstanceOf(
      MemoTooLargeError,
    );
  });
});
