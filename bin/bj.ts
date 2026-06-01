#!/usr/bin/env bun
/**
 * bj — Bettyjane command-line inspector (litcli style).
 *
 * Usage:
 *   bun bin/bj.ts inspect <txid> [--network mainnet|testnet] [--json]
 *   bun bin/bj.ts inspect <txid> -n mainnet --json
 *
 * For now only the "inspect" subcommand exists; more (mint, list, etc.)
 * will be added as the bootstrap CLI grows.
 */

import { ChronikClient } from "chronik-client";
import { Script, fromHex } from "ecash-lib";
import {
  decodeMemo,
  type Memo,
  type Network,
} from "../src/index";
import { networkConfig } from "../src/infrastructure/ecash/network";
import { DUST_SATS } from "../src/infrastructure/ecash/protocol";
import { MalformedMemoError, UnsupportedVersionError } from "../src/infrastructure/ecash/errors";

const USAGE = `bj — Bettyjane inspector

Usage:
  bj inspect <txid> [options]

Options:
  -n, --network <net>   mainnet | testnet   (default: mainnet)
  --json                machine-readable output
  -h, --help            show help

Examples:
  bun bin/bj.ts inspect a8ef7cba75... --network mainnet
  bun bin/bj.ts inspect a8ef7cba75... --json
`;

interface InspectResult {
  txid: string;
  network: Network;
  block?: { height: number; hash: string; timestamp: number };
  opReturn: {
    sats: bigint;
    scriptHex: string;
  };
  memoCoin: {
    outpoint: string; // txid:vout
    sats: bigint;
    spentBy?: string; // txid:vout if spent
    live: boolean;
  };
  memo: Memo | null;
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  const subcommand = args[0];

  if (subcommand !== "inspect") {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error(USAGE);
    process.exit(1);
  }

  // Parse flags (very small hand-rolled parser — no extra deps)
  let txid = "";
  let network: Network = "mainnet";
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") {
      json = true;
    } else if (a === "-n" || a === "--network") {
      const val = args[++i];
      if (val !== "mainnet" && val !== "testnet") {
        console.error(`Invalid network: ${val}. Use mainnet or testnet.`);
        process.exit(1);
      }
      network = val;
    } else if (!a.startsWith("-")) {
      if (txid) {
        console.error("Only one txid is supported");
        process.exit(1);
      }
      txid = a;
    } else {
      console.error(`Unknown flag: ${a}`);
      console.error(USAGE);
      process.exit(1);
    }
  }

  if (!txid) {
    console.error("Missing txid");
    console.error(USAGE);
    process.exit(1);
  }

  // Basic txid sanity (64 hex chars)
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    console.error(`Invalid txid (expected 64 hex chars): ${txid}`);
    process.exit(1);
  }

  const result = await inspectTx(txid.toLowerCase(), network);

  if (json) {
    console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    process.exit(result.error ? 1 : 0);
  }

  // Human output (litcli-ish: clear, high-signal, scannable)
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
    opReturn: {
      sats: opReturn?.sats ?? 0n,
      scriptHex: opReturn?.outputScript ?? "",
    },
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
    const script = new Script(fromHex(opReturn.outputScript));
    const memo = decodeMemo(script);
    result.memo = memo;
    if (!memo) {
      result.error = "Not a Bettyjane memo (different LOKAD ID or not OP_RETURN)";
    }
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

  // Memo coin line (the actual identity of the pin/memory)
  const liveBadge = r.memoCoin.live ? "LIVE" : "SPENT";
  console.log(`memo coin: ${r.memoCoin.outpoint}   (${r.memoCoin.sats} sats, ${liveBadge})`);
  if (r.memoCoin.spentBy) {
    console.log(`  spent by: ${r.memoCoin.spentBy}`);
  }
  console.log("");

  if (!r.memo) {
    console.log("No parsable Bettyjane memo found.");
    return;
  }

  // The good stuff
  console.log(`kind:  ${r.memo.kind}`);
  console.log(`type:  ${r.memo.content.type}`);
  console.log("");

  if (r.memo.content.type === "text") {
    console.log(r.memo.content.text);
  } else {
    console.log(`pointer: ${Buffer.from(r.memo.content.pointer).toString("hex")}`);
  }

  console.log("");
  console.log(`OP_RETURN: ${r.opReturn.scriptHex}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
