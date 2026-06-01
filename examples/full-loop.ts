#!/usr/bin/env bun
/**
 * Bettyjane end-to-end loop on eCash testnet, using only the public API.
 *
 * It derives (or recovers) a wallet, waits for the agent address to be funded,
 * then exercises the agent verbs against the live chain: remember a note, read
 * the live memory back, then forget the note. Forgetting sweeps the coin's value
 * back to the same address, so the funds recycle across runs (only network fees
 * are spent).
 *
 * It honors BJ_NETWORK (default testnet) and an optional BJ_CHRONIK_URL, so it
 * can run against a local regtest node as well as testnet.
 *
 * Funding is a manual step on testnet. The public faucet is browser-only and
 * frequently down, and the official cashtab-faucet is reCAPTCHA-gated, so
 * neither can be driven headlessly. Send testnet XEC (from a faucet or your own
 * wallet) to the address printed below; this script then waits for it to arrive.
 * For a self-contained run with no faucet, point it at a regtest node and
 * generate coins to the address yourself (see docs/testnet-and-e2e.md).
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
