export type Network = "mainnet" | "testnet" | "regtest";

export interface NetworkConfig {
  readonly network: Network;
  /** Cashaddr prefix for addresses on this network ("ecash" / "ectest" / "ecregtest"). */
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
  // No public endpoint for a private chain; default to a locally bound Chronik.
  regtest: {
    network: "regtest",
    prefix: "ecregtest",
    chronikUrls: ["http://127.0.0.1:8331"],
  },
};

/** Development targets testnet by default so a bootstrap never touches real XEC. */
export const DEFAULT_NETWORK: Network = "testnet";

export interface NetworkOverrides {
  readonly chronikUrls?: readonly string[];
}

export function networkConfig(
  network: Network = DEFAULT_NETWORK,
  overrides: NetworkOverrides = {},
): NetworkConfig {
  const base = DEFAULTS[network];
  return overrides.chronikUrls ? { ...base, chronikUrls: overrides.chronikUrls } : base;
}
