#!/usr/bin/env bun
/**
 * SessionEnd hook: tidy the agent's live memory when the session closes.
 *
 * Stop captures a memory per turn; SessionEnd consolidates the pile. It reads
 * the agent's live memories, embeds each, and forgets near-duplicates — grouped
 * by similarity, so it collapses reworded repeats, not just exact matches —
 * keeping one coin per cluster. Forgetting sweeps the dust back to the agent, so
 * consolidation also recycles funding.
 *
 * Like capture, it is opt-in and best-effort: it does nothing unless BJ_CAPTURE
 * is truthy AND a wallet is configured, it never blocks shutdown (always exits
 * 0), and any failure is reported on stderr and swallowed.
 *
 * Configure with BJ_CAPTURE=1 plus BJ_MNEMONIC / BJ_NETWORK (see hooks/README.md).
 */

import "ecash-lib/dist/initNodeJs.js";
import {
  HashEmbedder,
  MemoReader,
  Minter,
  coinId,
  loadWallet,
  planConsolidation,
  type LiveCoin,
  type Network,
  type VectoredMemory,
} from "../src/index";

const ENABLED = new Set(["1", "true", "yes"]);
// Two memories at or above this cosine similarity are treated as one.
const SIMILARITY_THRESHOLD = 0.9;

async function vectoredMemories(
  reader: MemoReader,
  coins: readonly LiveCoin[],
): Promise<VectoredMemory[]> {
  const embedder = new HashEmbedder();
  const memories: VectoredMemory[] = [];
  for (const coin of coins) {
    memories.push({ id: coinId(coin.outpoint), vector: await embedder.embed(await reader.resolveText(coin)) });
  }
  return memories;
}

async function main(): Promise<void> {
  if (!ENABLED.has((process.env.BJ_CAPTURE ?? "").toLowerCase())) return;
  if (!process.env.BJ_MNEMONIC) return;

  const network = (process.env.BJ_NETWORK as Network) || "testnet";
  const wallet = loadWallet();
  const reader = MemoReader.fromNetwork(network);
  const coins = await reader.listLiveCoins(wallet.address("agent"));
  const stale = planConsolidation(await vectoredMemories(reader, coins), SIMILARITY_THRESHOLD);
  if (stale.length === 0) return;

  const minter = Minter.fromNetwork(network);
  const signer = wallet.signer("agent");
  for (const id of stale) {
    const { txid } = await minter.forget(id, signer);
    process.stderr.write(`bettyjane: forgot near-duplicate ${id} -> ${txid}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`bettyjane consolidate hook: ${error}\n`);
});
