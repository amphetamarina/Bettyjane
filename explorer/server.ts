#!/usr/bin/env bun
/**
 * bj explorer — a tiny local web view of the live memory at an address.
 *
 * Usage:
 *   bun run watch <address> [--network mainnet|testnet|regtest] [--port 4173]
 *   bun explorer/server.ts ecash:qq3u... -n mainnet
 *
 * It serves a static page that polls /api/memories and renders every unspent
 * memo coin at the address — pins and memories — formatted for a human reader.
 * Read-only: it never mints or spends.
 */

import { join } from "node:path";
import { MemoReader, networkConfig, type Network } from "../src/index";
import { toMemoryView } from "./view";

interface Options {
  address: string;
  network: Network;
  port: number;
}

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "regtest"];
const DEFAULT_PORT = 4173;
const HERE = import.meta.dir;

function parseArgs(argv: readonly string[]): Options {
  let address = "";
  let network: Network = "mainnet";
  let port = DEFAULT_PORT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-n" || arg === "--network") {
      const value = argv[++i];
      if (!NETWORKS.includes(value as Network)) {
        fail(`Invalid network: ${value}. Use one of ${NETWORKS.join(", ")}.`);
      }
      network = value as Network;
    } else if (arg === "-p" || arg === "--port") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) fail(`Invalid port: ${value}`);
      port = value;
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      if (address) fail("Only one address is supported");
      address = arg;
    } else {
      fail(`Unknown flag: ${arg}`);
    }
  }

  if (!address) {
    printUsage();
    process.exit(1);
  }
  return { address, network, port };
}

async function fetchMemories(options: Options) {
  const reader = MemoReader.fromNetwork(networkConfig(options.network));
  const coins = await reader.listLiveCoins(options.address);
  const memories = coins.map((coin) => toMemoryView(coin, options.network));
  return { address: options.address, network: options.network, memories };
}

function start(options: Options) {
  const server = Bun.serve({
    port: options.port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/memories") {
        try {
          const payload = await fetchMemories(options);
          return Response.json(payload);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 502 },
          );
        }
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(Bun.file(join(HERE, "index.html")));
      }
      if (url.pathname === "/app.js") {
        return new Response(Bun.file(join(HERE, "app.js")));
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const watching = `${options.address} on ${options.network}`;
  console.log(`bj explorer watching ${watching}`);
  console.log(`  open http://localhost:${server.port}`);
}

function printUsage() {
  console.log(`bj explorer — visual view of the live memory at an address

Usage:
  bun run watch <address> [options]

Options:
  -n, --network <net>   mainnet | testnet | regtest   (default: mainnet)
  -p, --port <port>     local port to serve on         (default: ${DEFAULT_PORT})
  -h, --help            show help
`);
}

function fail(message: string): never {
  console.error(message);
  printUsage();
  process.exit(1);
}

if (import.meta.main) {
  start(parseArgs(process.argv.slice(2)));
}
