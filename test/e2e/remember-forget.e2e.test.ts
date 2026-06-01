import { beforeAll, describe, expect, test } from "bun:test";
import {
  type LiveCoin,
  MEMO_COIN_VOUT,
  MemoReader,
  Minter,
  type Signer,
  coinId,
  loadWallet,
} from "../../src/index";

/**
 * Live end-to-end coverage against eCash testnet: remember a note, see the coin
 * land in the live memory, then forget it and see it leave. Skipped unless
 * BJ_MNEMONIC is set, so the default `bun test` stays hermetic; the secret-
 * holder funds the agent address out of band (see examples/README.md).
 *
 * Forgetting sweeps the coin's value back to the same address, so a funded
 * wallet recycles across runs and only loses network fees.
 */

const NETWORK = "testnet";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 180_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(coin: LiveCoin): string | null {
  return coin.memo.content.type === "text" ? coin.memo.content.text : null;
}

async function pollFor<T>(
  poll: () => Promise<T | null>,
  description: string,
): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const found = await poll();
    if (found !== null) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

describe.skipIf(!process.env.BJ_MNEMONIC)("e2e: remember and forget on testnet", () => {
  let agent: Signer;
  let minter: Minter;
  let reader: MemoReader;

  beforeAll(() => {
    const wallet = loadWallet({ ...process.env, BJ_NETWORK: NETWORK });
    agent = wallet.signer("agent");
    minter = Minter.fromNetwork(NETWORK);
    reader = MemoReader.fromNetwork(NETWORK);
  });

  test(
    "remembers a note, sees it live, forgets it, sees it gone",
    async () => {
      const note = `bettyjane e2e ${Date.now()}-${process.pid}`;

      const minted = await minter.remember(note, agent);
      const id = coinId({ txid: minted.txid, outIdx: MEMO_COIN_VOUT });

      const live = await pollFor(async () => {
        const coins = await reader.listLiveCoins(agent.address);
        return coins.find((coin) => textOf(coin) === note) ?? null;
      }, `remembered coin ${id} to appear`);
      expect(coinId(live.outpoint)).toBe(id);
      expect(live.memo.kind).toBe("memory");

      await minter.forget(id, agent);

      const gone = await pollFor(async () => {
        const coins = await reader.listLiveCoins(agent.address);
        return coins.every((coin) => coinId(coin.outpoint) !== id) ? true : null;
      }, `forgotten coin ${id} to disappear`);
      expect(gone).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
