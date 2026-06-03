#!/usr/bin/env bun
/**
 * bj — Bettyjane command-line tool (litcli style).
 *
 * Subcommands:
 *   inspect <txid>   decode the memo in a transaction and report its coin
 *   pin <note>       mint a durable human pin (signed with the human key)
 *   unpin <id>       forget a pin by its coin id (txid:vout)
 *   init             show the wallet's addresses, funding, and current memory
 *
 * The write subcommands and init read the wallet from the environment
 * (BJ_MNEMONIC / BJ_NETWORK / BJ_PASSPHRASE); inspect needs no wallet.
 */

import "ecash-lib/dist/initNodeJs.js";
import {
  DEFAULT_NAMESPACE,
  MemoReader,
  Minter,
  assessFunding,
  decodeMemoHex,
  loadWallet,
  type Memo,
  type Network,
} from "../src/index";
import { ChronikClient } from "chronik-client";
import { networkConfig } from "../src/infrastructure/ecash/network";
import { DUST_SATS } from "../src/infrastructure/ecash/protocol";
import { MalformedMemoError, UnsupportedVersionError } from "../src/infrastructure/ecash/errors";

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "regtest"];

const USAGE = `bj — Bettyjane command-line tool

Usage:
  bj inspect <txid> [--network <net>] [--json]
  bj pin <note>     [--network <net>]
  bj unpin <id>     [--network <net>]
  bj init           [--network <net>] [--namespace <name>] [--pin <note> ...]

Options:
  -n, --network <net>   mainnet | testnet | regtest   (inspect defaults to mainnet,
                        the others default to $BJ_NETWORK or testnet)
  --namespace <name>    derive a named memory namespace's addresses (init only;
                        default namespace reproduces the original addresses)
  --json                machine-readable output (inspect only)
  --pin <note>          a pin to mint during init (repeatable)
  -h, --help            show help

The pin / unpin / init commands read the wallet from BJ_MNEMONIC /
BJ_NETWORK / BJ_PASSPHRASE. pin and unpin sign with the human key.
`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseNetwork(value: string | undefined): Network {
  if (!NETWORKS.includes(value as Network)) {
    fail(`Invalid network: ${value}. Use one of ${NETWORKS.join(", ")}.`);
  }
  return value as Network;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "inspect":
      return runInspect(rest);
    case "pin":
      return runPin(rest);
    case "unpin":
      return runUnpin(rest);
    case "init":
      return runInit(rest);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error(USAGE);
      process.exit(1);
  }
}

/** Load the wallet for a write/read command, overriding the network from the flag. */
function walletFor(network: Network) {
  if (!process.env.BJ_MNEMONIC) fail("BJ_MNEMONIC is not set; export the team mnemonic first.");
  return loadWallet({ ...process.env, BJ_NETWORK: network });
}

async function runPin(args: string[]): Promise<void> {
  let note = "";
  let network = parseNetwork(process.env.BJ_NETWORK ?? "testnet");
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n" || a === "--network") network = parseNetwork(args[++i]);
    else if (!a.startsWith("-")) note = note ? `${note} ${a}` : a;
    else fail(`Unknown flag: ${a}`);
  }
  if (!note) fail("Missing note to pin.");

  const wallet = walletFor(network);
  const { txid } = await Minter.fromNetwork(network).pin(note, wallet.signer("human"));
  console.log(`pinned "${note}" -> ${txid}`);
}

async function runUnpin(args: string[]): Promise<void> {
  let id = "";
  let network = parseNetwork(process.env.BJ_NETWORK ?? "testnet");
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n" || a === "--network") network = parseNetwork(args[++i]);
    else if (!a.startsWith("-")) id = a;
    else fail(`Unknown flag: ${a}`);
  }
  if (!id) fail("Missing pin id (txid:vout) to unpin.");

  const wallet = walletFor(network);
  const { txid } = await Minter.fromNetwork(network).unpin(id, wallet.signer("human"));
  console.log(`unpinned ${id} -> ${txid}`);
}

async function runInit(args: string[]): Promise<void> {
  let network = parseNetwork(process.env.BJ_NETWORK ?? "testnet");
  let namespace = DEFAULT_NAMESPACE;
  const pins: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n" || a === "--network") network = parseNetwork(args[++i]);
    else if (a === "--namespace") namespace = args[++i] ?? fail("--namespace needs a name");
    else if (a === "--pin") pins.push(args[++i] ?? fail("--pin needs a note"));
    else fail(`Unknown flag: ${a}`);
  }

  const wallet = walletFor(network);
  const human = wallet.address("human", namespace);
  const agent = wallet.address("agent", namespace);
  const config = networkConfig(network);
  const client = new ChronikClient([...config.chronikUrls]);

  const fundingOf = async (address: string) => {
    const { utxos } = await client.address(address).utxos();
    return assessFunding(
      utxos.map((u) => ({ sats: u.sats, confirmed: u.blockHeight !== -1 })),
      { minimumSats: DUST_SATS * 3n }, // a coin's dust plus headroom for the fee
    );
  };

  const reader = MemoReader.fromNetwork(network);
  const [humanFunding, agentFunding, livePins, memories] = await Promise.all([
    fundingOf(human),
    fundingOf(agent),
    reader.listLiveCoins(human),
    reader.listLiveCoins(agent),
  ]);

  console.log(`Bettyjane wallet (${network}${namespace === DEFAULT_NAMESPACE ? "" : `, namespace "${namespace}"`})`);
  console.log(`  human / pin address:    ${human}`);
  console.log(`    funding: ${humanFunding.totalSats} sats (${humanFunding.funded ? "funded" : "NOT funded — fund this to pin"}), live pins: ${livePins.length}`);
  console.log(`  agent / memory address: ${agent}`);
  console.log(`    funding: ${agentFunding.totalSats} sats (${agentFunding.funded ? "funded" : "NOT funded — fund this to capture"}), live memories: ${memories.length}`);

  if (pins.length === 0) {
    console.log("\nFund the addresses above, then re-run with --pin to mint initial pins (signed with the human key).");
    return;
  }
  // Pins are signed with the human key, so the human address must be funded.
  if (!humanFunding.funded) fail("\nThe human/pin address is not funded yet; fund it before minting pins.");

  const results = await Minter.fromNetwork(network).mintAll(
    pins.map((p) => ({ kind: "pin" as const, content: { type: "text" as const, text: p } })),
    wallet.signer("human", namespace),
  );
  for (const r of results) console.log(`pinned -> ${r.txid}`);
}

interface InspectResult {
  txid: string;
  network: Network;
  block?: { height: number; hash: string; timestamp: number };
  opReturn: { sats: bigint; scriptHex: string };
  memoCoin: { outpoint: string; sats: bigint; spentBy?: string; live: boolean };
  memo: Memo | null;
  error?: string;
}

async function runInspect(args: string[]): Promise<void> {
  let txid = "";
  let network: Network = "mainnet";
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "-n" || a === "--network") {
      const val = args[++i];
      if (val !== "mainnet" && val !== "testnet" && val !== "regtest") {
        fail(`Invalid network: ${val}. Use mainnet, testnet, or regtest.`);
      }
      network = val;
    } else if (!a.startsWith("-")) {
      if (txid) fail("Only one txid is supported");
      txid = a;
    } else fail(`Unknown flag: ${a}`);
  }

  if (!txid) fail("Missing txid");
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) fail(`Invalid txid (expected 64 hex chars): ${txid}`);

  const result = await inspectTx(txid.toLowerCase(), network);
  if (json) {
    console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    process.exit(result.error ? 1 : 0);
  }
  printHuman(result);
  process.exit(result.error ? 1 : 0);
}

async function inspectTx(txid: string, network: Network): Promise<InspectResult> {
  const config = networkConfig(network);
  const client = new ChronikClient([...config.chronikUrls]);

  let tx;
  try {
    tx = await client.tx(txid);
  } catch (e: any) {
    return {
      txid,
      network,
      opReturn: { sats: 0n, scriptHex: "" },
      memoCoin: { outpoint: `${txid}:1`, sats: DUST_SATS, live: false },
      memo: null,
      error: `Failed to fetch tx from Chronik: ${e?.message ?? e}`,
    };
  }

  const opReturn = tx.outputs[0];
  const memoOut = tx.outputs[1];

  const result: InspectResult = {
    txid,
    network,
    block: tx.block ?? undefined,
    opReturn: { sats: opReturn?.sats ?? 0n, scriptHex: opReturn?.outputScript ?? "" },
    memoCoin: {
      outpoint: `${txid}:1`,
      sats: memoOut?.sats ?? DUST_SATS,
      spentBy: memoOut?.spentBy ? `${memoOut.spentBy.txid}:${memoOut.spentBy.outIdx}` : undefined,
      live: !memoOut?.spentBy,
    },
    memo: null,
  };

  if (!opReturn) {
    result.error = "Transaction has no outputs";
    return result;
  }

  try {
    const memo = decodeMemoHex(opReturn.outputScript);
    result.memo = memo;
    if (!memo) result.error = "Not a Bettyjane memo (different LOKAD ID or not OP_RETURN)";
  } catch (e: any) {
    if (e instanceof MalformedMemoError || e instanceof UnsupportedVersionError) {
      result.error = `Malformed Bettyjane memo: ${e.message}`;
    } else {
      result.error = `Decode error: ${e?.message ?? e}`;
    }
  }

  return result;
}

function printHuman(r: InspectResult) {
  console.log(`\n${r.txid}  (${r.network})`);
  if (r.block) {
    console.log(`block ${r.block.height}  ${new Date(r.block.timestamp * 1000).toISOString()}`);
  } else {
    console.log("in mempool / unconfirmed");
  }
  console.log("");

  if (r.error && !r.memo) {
    console.log(`! ${r.error}`);
    console.log(`OP_RETURN script: ${r.opReturn.scriptHex}`);
    return;
  }

  const liveBadge = r.memoCoin.live ? "LIVE" : "SPENT";
  console.log(`memo coin: ${r.memoCoin.outpoint}   (${r.memoCoin.sats} sats, ${liveBadge})`);
  if (r.memoCoin.spentBy) console.log(`  spent by: ${r.memoCoin.spentBy}`);
  console.log("");

  if (!r.memo) {
    console.log("No parsable Bettyjane memo found.");
    return;
  }

  console.log(`kind:  ${r.memo.kind}`);
  console.log(`type:  ${r.memo.content.type}`);
  console.log("");
  if (r.memo.content.type === "text") console.log(r.memo.content.text);
  else console.log(`pointer: ${Buffer.from(r.memo.content.pointer).toString("hex")}`);
  console.log("");
  console.log(`OP_RETURN: ${r.opReturn.scriptHex}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
