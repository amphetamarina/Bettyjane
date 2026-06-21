import type { Network } from "../src/infrastructure/ecash/network";
import { fetchDiscover } from "../explorer/discover";

/**
 * Vercel serverless endpoint: GET /api/discover?network=<net>. Read-only.
 * Mirrors api/memories.ts; wraps the body so any failure comes back as JSON,
 * never an opaque platform 500.
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

function first(value: QueryValue): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

export function parseDiscoverQuery(query: Record<string, QueryValue>): { network: Network } {
  const networkParam = first(query.network);
  return {
    network: NETWORKS.includes(networkParam as Network) ? (networkParam as Network) : "mainnet",
  };
}

function queryOf(req: ApiRequest): Record<string, QueryValue> {
  if (req.query) return req.query;
  const search = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  return Object.fromEntries(new URLSearchParams(search));
}

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
    const { network } = parseDiscoverQuery(queryOf(req));
    send(res, 200, await fetchDiscover(network));
  } catch (error) {
    send(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
}
