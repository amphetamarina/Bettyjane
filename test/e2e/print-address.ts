#!/usr/bin/env bun
/**
 * Print an address for the wallet resolved from the environment (BJ_MNEMONIC /
 * BJ_NETWORK). The first CLI argument selects which:
 *   - "agent" (default) / "human": the author's P2PKH address.
 *   - "consensus": the 2-of-2 P2SH address over the agent and human pubkeys.
 * The regtest e2e workflow uses it to know which addresses to generate coins to.
 * No trailing newline, so it captures cleanly in a shell substitution.
 */

import "ecash-lib/dist/initNodeJs.js";
import { type Author, type Network, consensusAddress, loadWallet, networkConfig } from "../../src/index";

const which = process.argv[2] ?? "agent";
const wallet = loadWallet();

if (which === "consensus") {
  const network = (process.env.BJ_NETWORK as Network) || "testnet";
  const prefix = networkConfig(network).prefix;
  process.stdout.write(consensusAddress([wallet.signer("agent").pubkey, wallet.signer("human").pubkey], prefix));
} else {
  process.stdout.write(wallet.signer(which as Author).address);
}
