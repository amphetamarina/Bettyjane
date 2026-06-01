#!/usr/bin/env bun
/**
 * Print the agent address for the wallet resolved from the environment
 * (BJ_MNEMONIC / BJ_NETWORK). The regtest e2e workflow uses it to know which
 * address to generate coins to. No trailing newline, so it captures cleanly in
 * a shell substitution.
 */

import "ecash-lib/dist/initNodeJs.js";
import { loadWallet } from "../../src/index";

process.stdout.write(loadWallet().signer("agent").address);
