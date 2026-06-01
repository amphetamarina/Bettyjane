/**
 * One place that ties an eCash network to the two things the rest of the code
 * needs from it: the cashaddr prefix that {@link Wallet} stamps onto addresses,
 * and the Chronik endpoints that {@link ChronikGateway} reads from. Endpoints
 * are sensible defaults, not law — operators override them per deployment.
 */

export type Network = "mainnet" | "testnet";

export interface NetworkConfig {
  readonly network: Network;
  /** Cashaddr prefix for addresses on this network ("ecash" / "ectest"). */
  readonly prefix: string;
  /** Chronik URLs, most-preferred first; the client fails over in order. */
  readonly chronikUrls: readonly string[];
}

const DEFAULTS: Record<Network, NetworkConfig> = {
  mainnet: {
    network: "mainnet",
    prefix: "ecash",
    chronikUrls: ["https://chronik.e.cash", "https://chronik-native.fabien.cash"],
  },
  testnet: {
    network: "testnet",
    prefix: "ectest",
    chronikUrls: ["https://chronik-testnet.fabien.cash"],
  },
};

/** Development targets testnet by default so a bootstrap never touches real XEC. */
export const DEFAULT_NETWORK: Network = "testnet";

export interface NetworkOverrides {
  readonly chronikUrls?: readonly string[];
}

/** Resolve a network to its config, optionally overriding the Chronik endpoints. */
export function networkConfig(
  network: Network = DEFAULT_NETWORK,
  overrides: NetworkOverrides = {},
): NetworkConfig {
  const base = DEFAULTS[network];
  return overrides.chronikUrls ? { ...base, chronikUrls: overrides.chronikUrls } : base;
}
