import type { Network } from "../src/index";
import { fetchAddressMemories } from "../explorer/memories";

/**
 * Vercel serverless endpoint: GET /api/memories?address=<ecash:...>&network=<net>.
 * Returns the same payload the local server does, so the static page is identical
 * whether it runs under `bun run watch` or a Vercel deploy. Read-only.
 *
 * The req/res shapes are typed structurally to avoid a build-time dependency on
 * @vercel/node; Vercel populates req.query and the res helpers at runtime.
 */

export type QueryValue = string | string[] | undefined;

interface ApiRequest {
  readonly query: Record<string, QueryValue>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "regtest"];

/** Coalesce a possibly-repeated query param to a single trimmed string. */
function first(value: QueryValue): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/** Pull the address and a whitelisted network (default mainnet) from a query. */
export function parseMemoriesQuery(query: Record<string, QueryValue>): {
  address: string;
  network: Network;
} {
  const networkParam = first(query.network);
  return {
    address: first(query.address),
    network: NETWORKS.includes(networkParam as Network) ? (networkParam as Network) : "mainnet",
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const { address, network } = parseMemoriesQuery(req.query);
  res.setHeader("Cache-Control", "no-store");

  if (!address) {
    res.status(400).json({ error: "address is required" });
    return;
  }

  try {
    res.status(200).json(await fetchAddressMemories(address, network));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
