#!/usr/bin/env bun
/**
 * The backgrounded half of capture. capture.ts spawns this detached so the
 * model call (seconds) never blocks the end of a turn. It reads the rendered
 * turn from the file named by its first argument, asks the distiller what is
 * worth remembering, and mints each note as an agent memory coin.
 *
 * Best-effort: if the distiller is unavailable or fails, it mints nothing and
 * logs why rather than falling back to a low-quality verbatim memory. It assumes
 * capture has already checked that capture is enabled and a wallet is present.
 */

import "ecash-lib/dist/initNodeJs.js";
import { unlinkSync } from "node:fs";
import { MAX_MEMORY_BYTES, loadWallet, sequentialMinter, type Network } from "../src/index";
import { distillWithClaude } from "./distiller";

async function main(): Promise<void> {
  const turnFile = process.argv[2];
  if (!turnFile) return;
  const turn = (await Bun.file(turnFile).text()).trim();
  try {
    unlinkSync(turnFile);
  } catch {
    // The temp file is best-effort cleanup; a failure here is not worth aborting.
  }
  if (!turn) return;

  let notes: string[];
  try {
    notes = await distillWithClaude(turn, { maxBytes: MAX_MEMORY_BYTES });
  } catch (error) {
    process.stderr.write(`bettyjane: distiller unavailable, remembered nothing (${error})\n`);
    return;
  }
  if (notes.length === 0) return;

  const network = (process.env.BJ_NETWORK as Network) || "testnet";
  // A change-threading minter so a turn's notes mint back to back without the
  // mempool rejecting the second as a txn-mempool-conflict.
  const minter = sequentialMinter(network);
  const signer = loadWallet().signer("agent");
  for (const note of notes) {
    const { txid } = await minter.remember(note, signer);
    process.stderr.write(`bettyjane: remembered "${note}" -> ${txid}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`bettyjane distill worker: ${error}\n`);
});
