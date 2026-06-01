#!/usr/bin/env bun
/**
 * Print an author's address for the wallet resolved from the environment
 * (BJ_MNEMONIC / BJ_NETWORK). The author is the first CLI argument and defaults
 * to "agent". The regtest e2e workflow uses it to know which address to generate
 * coins to (agent), and a second address to mine maturity-padding blocks to.
 * No trailing newline, so it captures cleanly in a shell substitution.
 */

import "ecash-lib/dist/initNodeJs.js";
import { type Author, loadWallet } from "../../src/index";

const author = (process.argv[2] ?? "agent") as Author;
process.stdout.write(loadWallet().signer(author).address);
