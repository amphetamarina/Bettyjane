#!/usr/bin/env bun
/**
 * bj explorer — a tiny local web view of the live memory at one or two addresses.
 *
 * Usage:
 *   bun run watch [agent-address] [--human <pin-address>] [--network <net>] [--port <n>]
 *   bun explorer/server.ts ecash:qq3u... --human ecash:qpry... -n mainnet
 *
 * It serves a static page whose inputs name the agent (memory) and human (pin)
 * addresses; the page polls /api/memories?address=&network= for each and renders
 * every unspent memo coin. Any address given on the command line just pre-fills
 * those inputs. Read-only: it never mints or spends.
 *
 * The page and the serverless function in api/ share explorer/memories.ts, so the
 * local server and a Vercel deploy render identically.
 */

import { join } from "node:path";
import type { Network } from "../src/index";
import { fetchAddressMemories } from "./memories";

interface Options {
  agent: string;
  human: string;
  network: Network;
  port: number;
}

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "regtest"];
const DEFAULT_PORT = 4173;
const PUBLIC_DIR = join(import.meta.dir, "..", "public");

function parseArgs(argv: readonly string[]): Options {
  let agent = "";
  let human = "";
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
    } else if (arg === "-H" || arg === "--human") {
      human = argv[++i] ?? fail("--human needs an address");
    } else if (arg === "-p" || arg === "--port") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) fail(`Invalid port: ${value}`);
      port = value;
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      if (agent) fail("Only one agent address is supported (use --human for the pin address)");
      agent = arg;
    } else {
      fail(`Unknown flag: ${arg}`);
    }
  }

  return { agent, human, network, port };
}

function parseNetwork(value: string | null): Network {
  return NETWORKS.includes(value as Network) ? (value as Network) : "mainnet";
}

function prefillQuery(options: Options): string {
  const params = new URLSearchParams();
  if (options.agent) params.set("agent", options.agent);
  if (options.human) params.set("human", options.human);
  params.set("network", options.network);
  return params.toString();
}

function start(options: Options) {
  const server = Bun.serve({
    port: options.port,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/api/memories") {
        const address = url.searchParams.get("address");
        if (!address) return Response.json({ error: "address is required" }, { status: 400 });
        const network = parseNetwork(url.searchParams.get("network"));
        try {
          return Response.json(await fetchAddressMemories(address, network));
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 502 },
          );
        }
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        if ((options.agent || options.human) && !url.search) {
          return Response.redirect(`/?${prefillQuery(options)}`, 302);
        }
        return new Response(Bun.file(join(PUBLIC_DIR, "index.html")));
      }
      if (url.pathname === "/app.js") {
        return new Response(Bun.file(join(PUBLIC_DIR, "app.js")));
      }
      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`bj explorer on ${options.network}`);
  if (options.agent) console.log(`  agent:  ${options.agent}`);
  if (options.human) console.log(`  human:  ${options.human}`);
  console.log(`  open http://localhost:${server.port}`);
}

function printUsage() {
  console.log(`bj explorer — visual view of the live memory at an address

Usage:
  bun run watch [agent-address] [options]

Options:
  -H, --human <address>   the human / pin address to also display
  -n, --network <net>     mainnet | testnet | regtest   (default: mainnet)
  -p, --port <port>       local port to serve on         (default: ${DEFAULT_PORT})
  -h, --help              show help

Addresses are optional on the command line; the page has inputs for both.
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
