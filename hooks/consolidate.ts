#!/usr/bin/env bun
/**
 * SessionEnd hook: tidy the agent's live memory when the session closes.
 *
 * Stop captures a memory per turn; SessionEnd consolidates the pile. It reads
 * the agent's live memory coins and forgets exact duplicates, keeping the newest
 * coin for each distinct (normalized) text. Forgetting sweeps the dust back to
 * the agent, so consolidation also recycles funding.
 *
 * Like capture, it is opt-in and best-effort: it does nothing unless BJ_CAPTURE
 * is truthy AND a wallet is configured, it never blocks shutdown (always exits
 * 0), and any failure is reported on stderr and swallowed.
 *
 * Configure with BJ_CAPTURE=1 plus BJ_MNEMONIC / BJ_NETWORK (see hooks/README.md).
 */

import "ecash-lib/dist/initNodeJs.js";
import { MemoReader, Minter, coinId, loadWallet, type LiveCoin, type Network } from "../src/index";
import { planForget, type MemoryCoin } from "./dedup";

const ENABLED = new Set(["1", "true", "yes"]);

function textMemories(coins: readonly LiveCoin[]): MemoryCoin[] {
  const memories: MemoryCoin[] = [];
  for (const coin of coins) {
    if (coin.memo.content.type === "text") {
      memories.push({ id: coinId(coin.outpoint), text: coin.memo.content.text });
    }
  }
  return memories;
}

async function main(): Promise<void> {
  if (!ENABLED.has((process.env.BJ_CAPTURE ?? "").toLowerCase())) return;
  if (!process.env.BJ_MNEMONIC) return;

  const network = (process.env.BJ_NETWORK as Network) || "testnet";
  const wallet = loadWallet();
  const reader = MemoReader.fromNetwork(network);
  const stale = planForget(textMemories(await reader.listLiveCoins(wallet.address("agent"))));
  if (stale.length === 0) return;

  const minter = Minter.fromNetwork(network);
  const signer = wallet.signer("agent");
  for (const id of stale) {
    const { txid } = await minter.forget(id, signer);
    process.stderr.write(`bettyjane: forgot duplicate ${id} -> ${txid}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`bettyjane consolidate hook: ${error}\n`);
});
