#!/usr/bin/env bun
/**
 * Stop hook: remember the turn that just ended as an on-chain memory.
 *
 * Distills the last thing the human asked into one line and mints it as an agent
 * memory coin. Opt-in: it does nothing unless BJ_CAPTURE is truthy AND a wallet
 * is configured, because every memory spends real value and — on mainnet — is
 * public and permanent. It never blocks the session: it always exits 0, and any
 * failure (no funds, network, oversize) is reported on stderr and swallowed.
 *
 * Configure with BJ_CAPTURE=1 plus BJ_MNEMONIC / BJ_NETWORK (see hooks/README.md).
 */

import "ecash-lib/dist/initNodeJs.js";
import { MAX_PAYLOAD_BYTES, Minter, loadWallet, type Network } from "../src/index";
import { distillTurn } from "./distill";

const ENABLED = new Set(["1", "true", "yes"]);
// Leave headroom under the OP_RETURN payload cap for the memo header.
const MEMO_BUDGET = MAX_PAYLOAD_BYTES - 40;

interface StopPayload {
  readonly transcript_path?: string;
  readonly stop_hook_active?: boolean;
}

async function main(): Promise<void> {
  if (!ENABLED.has((process.env.BJ_CAPTURE ?? "").toLowerCase())) return;
  if (!process.env.BJ_MNEMONIC) return;

  const payload = JSON.parse(await Bun.stdin.text()) as StopPayload;
  if (payload.stop_hook_active || !payload.transcript_path) return;

  const lines = (await Bun.file(payload.transcript_path).text()).split("\n");
  const memory = distillTurn(lines, MEMO_BUDGET);
  if (!memory) return;

  const network = (process.env.BJ_NETWORK as Network) || "testnet";
  const minter = Minter.fromNetwork(network);
  const { txid } = await minter.remember(memory, loadWallet().signer("agent"));
  process.stderr.write(`bettyjane: remembered "${memory}" -> ${txid}\n`);
}

main().catch((error) => {
  process.stderr.write(`bettyjane capture hook: ${error}\n`);
});
