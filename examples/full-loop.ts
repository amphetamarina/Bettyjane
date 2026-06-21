#!/usr/bin/env bun
/**
 * End-to-end loop on eCash testnet using only the public API: derive/recover a
 * wallet, wait for funding, then remember a note, read it back, and forget it.
 * Forgetting sweeps the coin's value back to the same address, so funds recycle
 * across runs (only fees are spent).
 *
 * Honors BJ_NETWORK (default testnet) and optional BJ_CHRONIK_URL, so it can run
 * against a local regtest node as well as testnet.
 *
 * Funding is manual on testnet: the public faucet is browser-only and the
 * cashtab-faucet is reCAPTCHA-gated, so neither runs headlessly. Send testnet
 * XEC to the address printed below. For a self-contained run, point at a regtest
 * node and generate coins yourself (see docs/testnet-and-e2e.md).
 *
 * Usage:
 *   BJ_MNEMONIC="twelve word phrase ..." bun examples/full-loop.ts
 *   bun examples/full-loop.ts            # generates a throwaway wallet
 */

import {
  ChronikGateway,
  MEMO_COIN_VOUT,
  MemoReader,
  Minter,
  type Network,
  type NetworkConfig,
  Wallet,
  coinId,
  generateMnemonic,
  loadWallet,
  networkConfig,
  type LiveCoin,
} from "../src/index";

const NETWORK = (process.env.BJ_NETWORK as Network) || "testnet";
const FAUCET_URL = "https://faucet.fabien.cash/";
const MINIMUM_SATS = 10_000n;
const FUNDING_TIMEOUT_MS = 10 * 60 * 1000;

function resolveConfig(): NetworkConfig {
  const url = process.env.BJ_CHRONIK_URL;
  return url ? networkConfig(NETWORK, { chronikUrls: [url] }) : networkConfig(NETWORK);
}

function resolveWallet(): Wallet {
  if (process.env.BJ_MNEMONIC) return loadWallet({ ...process.env, BJ_NETWORK: NETWORK });
  const mnemonic = generateMnemonic();
  console.log("No BJ_MNEMONIC set; generated a throwaway wallet.");
  console.log("Save this phrase to reuse its funds on the next run:");
  console.log(`  ${mnemonic}\n`);
  return Wallet.fromMnemonic(mnemonic, { prefix: networkConfig(NETWORK).prefix });
}

function describe(coins: readonly LiveCoin[]): string {
  if (coins.length === 0) return "  (none)";
  return coins
    .map((coin) => {
      const content = coin.memo.content.type === "text" ? coin.memo.content.text : "<pointer>";
      const state = coin.confirmed ? "confirmed" : "mempool";
      return `  ${coinId(coin.outpoint)}  [${coin.memo.kind}, ${state}]  ${content}`;
    })
    .join("\n");
}

async function main() {
  const config = resolveConfig();
  const wallet = resolveWallet();
  const agent = wallet.signer("agent");

  console.log(`Fund the ${NETWORK} agent address (>= ${MINIMUM_SATS} sats):`);
  console.log(`  ${agent.address}`);
  if (NETWORK === "testnet") console.log(`Faucet (often down): ${FAUCET_URL}`);
  console.log("");

  const chronik = ChronikGateway.fromNetwork(config);
  console.log("Waiting for funding...");
  const status = await chronik.awaitFunding(
    agent.address,
    { minimumSats: MINIMUM_SATS },
    { pollIntervalMs: 5000, timeoutMs: FUNDING_TIMEOUT_MS },
  );
  console.log(`Funded: ${status.totalSats} sats seen.\n`);

  const minter = Minter.fromNetwork(config);
  const reader = MemoReader.fromNetwork(config);

  const note = `deploys run from CI only (example ${new Date().toISOString()})`;
  console.log(`remember: "${note}"`);
  const minted = await minter.remember(note, agent);
  const id = coinId({ txid: minted.txid, outIdx: MEMO_COIN_VOUT });
  console.log(`  minted coin ${id} in tx ${minted.txid}\n`);

  console.log("live memory after remember:");
  console.log(describe(await reader.listLiveCoins(agent.address)), "\n");

  console.log(`forget: ${id}`);
  const forgotten = await minter.forget(id, agent);
  console.log(`  spent in tx ${forgotten.txid}\n`);

  console.log("live memory after forget:");
  console.log(describe(await reader.listLiveCoins(agent.address)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
