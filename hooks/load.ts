#!/usr/bin/env bun
/**
 * SessionStart hook: wake Claude up knowing what the team remembers.
 *
 * Uses loadMemory to read the team's current memory — the human's durable pins
 * and a working set of the agent's memories, with pointer memories reassembled
 * to full text — and prints it to stdout, which Claude Code adds to the session
 * as context. Read-only and best-effort: with no wallet configured it stays
 * silent, and any failure just means no memory context, so it never blocks the
 * session.
 *
 * Configure with BJ_MNEMONIC / BJ_NETWORK / BJ_PASSPHRASE (see hooks/README.md).
 */

import "ecash-lib/dist/initNodeJs.js";
import { MemoReader, type LoadedMemory, loadMemory, loadWallet, type Network } from "../src/index";

function render(network: Network, agentAddress: string, memory: LoadedMemory): string {
  const lines = [`Bettyjane memory (${network}). Agent address: ${agentAddress}`];
  lines.push(memory.pins.length ? "Pins (human, durable):" : "Pins: (none)");
  for (const pin of memory.pins) lines.push(`  - ${pin}`);
  lines.push(memory.memories.length ? "Memories (agent, working):" : "Memories: (none yet)");
  for (const m of memory.memories) lines.push(`  - [${m.id}] ${m.text}`);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  if (!process.env.BJ_MNEMONIC) return;
  const network = (process.env.BJ_NETWORK as Network) || "testnet";
  const wallet = loadWallet();
  const reader = MemoReader.fromNetwork(network);
  const memory = await loadMemory(reader, {
    pin: wallet.address("human"),
    memory: wallet.address("agent"),
  });
  process.stdout.write(render(network, wallet.address("agent"), memory));
}

main().catch((error) => {
  process.stderr.write(`bettyjane load hook: ${error}\n`);
});
