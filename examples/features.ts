#!/usr/bin/env bun
/**
 * A guided tour of the post-v0.1.0 features, using only the public API. Every
 * step here runs offline (no network, no funding) so you can read it as a "how
 * to use each feature" reference and run it as-is:
 *
 *   bun examples/features.ts
 *
 * Each section also shows, in a comment, the one on-chain call that mints the
 * feature for real (those need a funded wallet — see examples/full-loop.ts).
 */

import "ecash-lib/dist/initNodeJs.js";
import { Address, Ecc } from "ecash-lib";
import {
  Wallet,
  batchMemos,
  consensus,
  consensusAddress,
  decodeSignedMemo,
  decryptWithSeckey,
  encodeMemo,
  encodeMemoBatch,
  encodeSignedMemo,
  encryptToPubkey,
  memory,
  signingDigest,
  text,
  verifyMemoAuthor,
} from "../src/index";

const line = (title: string) => console.log(`\n— ${title} —`);

const wallet = Wallet.fromMnemonic(
  process.env.BJ_MNEMONIC ??
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  { prefix: "ectest" },
);
const agent = wallet.signer("agent");
const human = wallet.signer("human");
const ecc = new Ecc();

// 1. Content-signed memories (AMP-239) — authorship provable from the coin alone.
line("content-signed memories");
{
  const memo = memory(text("the build is green"));
  const sig = ecc.signRecoverable(agent.seckey, signingDigest(memo));
  const ownerScript = Address.fromCashAddress(agent.address).toScript().bytecode;
  const script = encodeSignedMemo(memo, sig);
  console.log("authorVerified:", verifyMemoAuthor(script, ownerScript, ecc));
  console.log("signature carried:", decodeSignedMemo(script)?.signature?.length, "bytes");
  // On chain (signs inline text automatically): await minter.remember("the build is green", agent)
}

// 2. Memory namespaces (AMP-243) — partition memory into watchable addresses.
line("memory namespaces");
{
  console.log("default :", wallet.address("agent"));
  console.log("billing :", wallet.address("agent", "billing"));
  console.log("infra   :", wallet.address("agent", "infra"));
  console.log("default == no-namespace:", wallet.address("agent", "") === wallet.address("agent"));
  // On chain: mint to a namespace by deriving its signer — wallet.signer("agent", "billing")
}

// 3. eMPP batching (AMP-240) — a turn's notes in one transaction.
line("eMPP batching");
{
  const notes = ["short note A", "short note B", "short note C"].map((t) => memory(text(t)));
  const batches = batchMemos(notes);
  console.log(`${notes.length} notes -> ${batches.length} transaction(s)`);
  console.log("one OP_RETURN bytes:", encodeMemoBatch(batches[0]!).bytecode.length, "(<= 223)");
  // On chain: await minter.rememberBatch(["short note A", "short note B", "short note C"], agent)
}

// 4. Encrypted private memories (AMP-242) — ciphertext on a public chain.
line("encrypted private memories");
{
  const secret = "rotate the staging token monthly";
  const blob = encryptToPubkey(new TextEncoder().encode(secret), agent.pubkey);
  const back = new TextDecoder().decode(decryptWithSeckey(blob, agent.seckey));
  console.log("ciphertext bytes:", blob.length, "| decrypts to original:", back === secret);
  console.log("plaintext on chain:", encodeMemo(memory(text(secret))).bytecode.length, "bytes vs ciphertext stays opaque");
  // On chain: await minter.rememberPrivate("rotate the staging token monthly", agent.pubkey, agent)
}

// 5. Consensus memories (AMP-244) — a 2-of-2 neither key can write alone.
line("2-of-2 consensus memories");
{
  const address = consensusAddress([agent.pubkey, human.pubkey], "ectest");
  console.log("2-of-2 address:", address);
  console.log("order-independent:", address === consensusAddress([human.pubkey, agent.pubkey], "ectest"));
  console.log("kind:", consensus(text("the team ratified X")).kind);
  // On chain (both keys sign):
  //   const minter = ConsensusMinter.fromNetwork("testnet")
  //   const signers = [{pubkey: agent.pubkey, seckey: agent.seckey}, {pubkey: human.pubkey, seckey: human.seckey}]
  //   await minter.mint(consensus(text("the team ratified X")), signers)
}

console.log("\nAll feature APIs exercised offline. See examples/full-loop.ts for an on-chain run.");
