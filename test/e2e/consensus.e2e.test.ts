import { beforeAll, describe, expect, test } from "bun:test";
import {
  ChronikGateway,
  ConsensusMinter,
  type ConsensusSigner,
  type LiveCoin,
  MEMO_COIN_VOUT,
  MemoReader,
  type Network,
  type NetworkConfig,
  coinId,
  consensus,
  consensusAddress,
  loadWallet,
  networkConfig,
  text,
} from "../../src/index";

/**
 * Live end-to-end coverage for consensus memories (AMP-244): mint a 2-of-2 memo
 * at the P2SH consensus address, see it land in the live memory, then forget it
 * and see it leave, every spend signed by both keys. This is the real test that
 * the 2-of-2 scriptSig actually validates on a node. Skipped unless BJ_MNEMONIC
 * is set; CI funds the consensus address on regtest (see e2e.yml).
 */

const NETWORK = (process.env.BJ_NETWORK as Network) || "testnet";
const FUNDING_MIN_SATS = 2000n;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 180_000;

function resolveConfig(): NetworkConfig {
  const url = process.env.BJ_CHRONIK_URL;
  return url ? networkConfig(NETWORK, { chronikUrls: [url] }) : networkConfig(NETWORK);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (coin: LiveCoin): string | null =>
  coin.memo.content.type === "text" ? coin.memo.content.text : null;

async function pollFor<T>(poll: () => Promise<T | null>, description: string): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const found = await poll();
    if (found !== null) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

describe.skipIf(!process.env.BJ_MNEMONIC)(`e2e: consensus memory on ${NETWORK}`, () => {
  let signers: ConsensusSigner[];
  let address: string;
  let minter: ConsensusMinter;
  let reader: MemoReader;
  let chronik: ChronikGateway;
  const prefix = resolveConfig().prefix;

  beforeAll(() => {
    if (NETWORK === "mainnet") throw new Error("refusing to run the e2e suite on mainnet");
    const config = resolveConfig();
    const wallet = loadWallet({ ...process.env, BJ_NETWORK: NETWORK });
    const agent = wallet.signer("agent");
    const human = wallet.signer("human");
    signers = [
      { pubkey: agent.pubkey, seckey: agent.seckey },
      { pubkey: human.pubkey, seckey: human.seckey },
    ];
    address = consensusAddress([agent.pubkey, human.pubkey], prefix);
    minter = ConsensusMinter.fromNetwork(config);
    reader = MemoReader.fromNetwork(config);
    chronik = ChronikGateway.fromNetwork(config);
  });

  test(
    "mints a 2-of-2 memo, sees it live, forgets it, sees it gone",
    async () => {
      await chronik.awaitFunding(
        address,
        { minimumSats: FUNDING_MIN_SATS },
        { pollIntervalMs: POLL_INTERVAL_MS, timeoutMs: POLL_TIMEOUT_MS },
      );

      const note = `bettyjane consensus e2e ${Date.now()}-${process.pid}`;
      const minted = await minter.mint(consensus(text(note)), signers, prefix);
      const id = coinId({ txid: minted.txid, outIdx: MEMO_COIN_VOUT });

      const live = await pollFor(async () => {
        const coins = await reader.listLiveCoins(address);
        return coins.find((coin) => textOf(coin) === note) ?? null;
      }, `consensus coin ${id} to appear`);
      expect(coinId(live.outpoint)).toBe(id);
      expect(live.memo.kind).toBe("consensus");

      await minter.forget({ txid: minted.txid, outIdx: MEMO_COIN_VOUT }, signers, prefix);

      const gone = await pollFor(async () => {
        const coins = await reader.listLiveCoins(address);
        return coins.every((coin) => coinId(coin.outpoint) !== id) ? true : null;
      }, `consensus coin ${id} to disappear`);
      expect(gone).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
