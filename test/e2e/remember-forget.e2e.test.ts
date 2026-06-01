import { beforeAll, describe, expect, test } from "bun:test";
import {
  ChronikGateway,
  type LiveCoin,
  MEMO_COIN_VOUT,
  MemoReader,
  Minter,
  type Network,
  type NetworkConfig,
  type Signer,
  coinId,
  loadWallet,
  networkConfig,
} from "../../src/index";

/**
 * Live end-to-end coverage: remember a note, see the coin land in the live
 * memory, then forget it and see it leave. Skipped unless BJ_MNEMONIC is set, so
 * the default `bun test` stays hermetic.
 *
 * It runs against whatever BJ_NETWORK selects. CI uses regtest with a local
 * in-node Chronik (BJ_CHRONIK_URL), where coins are generated on demand, so no
 * faucet is involved; it can also run against testnet with a hand-funded wallet.
 * Forgetting sweeps the coin's value back to the same address, so a funded
 * wallet recycles across runs and only loses network fees.
 */

const NETWORK = (process.env.BJ_NETWORK as Network) || "testnet";
const FUNDING_MIN_SATS = 2000n;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 180_000;

/** Honor BJ_CHRONIK_URL so the suite can point at a local regtest node. */
function resolveConfig(): NetworkConfig {
  const url = process.env.BJ_CHRONIK_URL;
  return url ? networkConfig(NETWORK, { chronikUrls: [url] }) : networkConfig(NETWORK);
}

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

describe.skipIf(!process.env.BJ_MNEMONIC)(`e2e: remember and forget on ${NETWORK}`, () => {
  let agent: Signer;
  let minter: Minter;
  let reader: MemoReader;
  let chronik: ChronikGateway;

  beforeAll(() => {
    if (NETWORK === "mainnet") {
      throw new Error("refusing to run the e2e suite on mainnet; use regtest or testnet");
    }
    const config = resolveConfig();
    const wallet = loadWallet({ ...process.env, BJ_NETWORK: NETWORK });
    agent = wallet.signer("agent");
    minter = Minter.fromNetwork(config);
    reader = MemoReader.fromNetwork(config);
    chronik = ChronikGateway.fromNetwork(config);
  });

  test(
    "remembers a note, sees it live, forgets it, sees it gone",
    async () => {
      // Wait for the address to be funded: on regtest this absorbs the lag
      // between generating coins and Chronik indexing them; on testnet it waits
      // for the hand-funding to arrive.
      await chronik.awaitFunding(
        agent.address,
        { minimumSats: FUNDING_MIN_SATS },
        { pollIntervalMs: POLL_INTERVAL_MS, timeoutMs: POLL_TIMEOUT_MS },
      );

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
