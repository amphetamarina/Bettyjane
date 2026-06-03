import type { Network } from "../src/infrastructure/ecash/network.js";
import { fetchAddressMemories } from "../explorer/memories.js";

/**
 * Vercel serverless endpoint: GET /api/memories?address=<ecash:...>&network=<net>.
 * Returns the same payload the local server does, so the static page is identical
 * whether it runs under `bun run watch` or a Vercel deploy. Read-only.
 *
 * The req/res shapes are typed structurally to avoid a build-time dependency on
 * @vercel/node. The whole body is wrapped so that any failure — including an
 * unexpected one — comes back as JSON the page can render, never an opaque
 * platform HTML 500.
 */

export type QueryValue = string | string[] | undefined;

interface ApiRequest {
  readonly query?: Record<string, QueryValue>;
  readonly url?: string;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
  statusCode?: number;
  end?(body: string): void;
}

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "regtest"];

/** Coalesce a possibly-repeated query param to a single trimmed string. */
function first(value: QueryValue): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/** Pull the address, a whitelisted network (default mainnet), and the include-spent flag from a query. */
export function parseMemoriesQuery(query: Record<string, QueryValue>): {
  address: string;
  network: Network;
  includeSpent: boolean;
} {
  const networkParam = first(query.network);
  const all = first(query.all).toLowerCase();
  return {
    address: first(query.address),
    network: NETWORKS.includes(networkParam as Network) ? (networkParam as Network) : "mainnet",
    includeSpent: all === "1" || all === "true" || all === "yes",
  };
}

/** Vercel populates req.query; fall back to parsing req.url so we never throw. */
function queryOf(req: ApiRequest): Record<string, QueryValue> {
  if (req.query) return req.query;
  const search = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  return Object.fromEntries(new URLSearchParams(search));
}

/** Send a JSON response, falling back to the raw stream if the helpers are absent. */
function send(res: ApiResponse, code: number, body: unknown): void {
  try {
    res.setHeader?.("Cache-Control", "no-store");
    res.status(code).json(body);
  } catch {
    res.statusCode = code;
    res.end?.(JSON.stringify(body));
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const { address, network, includeSpent } = parseMemoriesQuery(queryOf(req));
    if (!address) {
      send(res, 400, { error: "address is required" });
      return;
    }
    send(res, 200, await fetchAddressMemories(address, network, undefined, includeSpent));
  } catch (error) {
    send(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
}
