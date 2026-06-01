#!/usr/bin/env bun
/**
 * SessionStart hook: wake Claude up knowing what the team remembers.
 *
 * Reads the live memory coins from the chain — the human's durable pins and the
 * agent's working memories — and prints them to stdout, which Claude Code adds
 * to the session as context. Read-only and best-effort: with no wallet
 * configured it stays silent, and any failure just means no memory context, so
 * it never blocks the session.
 *
 * Configure with BJ_MNEMONIC / BJ_NETWORK / BJ_PASSPHRASE (see hooks/README.md).
 */

import "ecash-lib/dist/initNodeJs.js";
import { MemoReader, coinId, loadWallet, type LiveCoin, type Network } from "../src/index";

function textOf(coin: LiveCoin): string {
  return coin.memo.content.type === "text" ? coin.memo.content.text : "<pointer>";
}

function render(
  network: Network,
  agentAddress: string,
  pins: readonly LiveCoin[],
  memories: readonly LiveCoin[],
): string {
  const lines = [`Bettyjane memory (${network}). Agent address: ${agentAddress}`];
  lines.push(pins.length ? "Pins (human, durable):" : "Pins: (none)");
  for (const coin of pins) lines.push(`  - ${textOf(coin)}`);
  lines.push(memories.length ? "Memories (agent, working):" : "Memories: (none yet)");
  for (const coin of memories) lines.push(`  - [${coinId(coin.outpoint)}] ${textOf(coin)}`);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  if (!process.env.BJ_MNEMONIC) return;
  const network = (process.env.BJ_NETWORK as Network) || "testnet";
  const wallet = loadWallet();
  const reader = MemoReader.fromNetwork(network);
  const [pins, memories] = await Promise.all([
    reader.listLiveCoins(wallet.address("human")),
    reader.listLiveCoins(wallet.address("agent")),
  ]);
  process.stdout.write(render(network, wallet.address("agent"), pins, memories));
}

main().catch((error) => {
  process.stderr.write(`bettyjane load hook: ${error}\n`);
});
