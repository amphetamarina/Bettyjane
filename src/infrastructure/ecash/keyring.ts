import { DEFAULT_NETWORK, type Network, networkConfig } from "./network";
import { Wallet } from "./wallet";

export const ENV_MNEMONIC = "BJ_MNEMONIC";
export const ENV_PASSPHRASE = "BJ_PASSPHRASE";
export const ENV_NETWORK = "BJ_NETWORK";

export type Env = Record<string, string | undefined>;

export class MissingMnemonicError extends Error {
  constructor() {
    super(`${ENV_MNEMONIC} is not set; export your BIP-39 phrase to load the wallet`);
    this.name = "MissingMnemonicError";
  }
}

export class InvalidNetworkError extends Error {
  constructor(readonly value: string) {
    super(`${ENV_NETWORK} must be "mainnet", "testnet", or "regtest", got "${value}"`);
    this.name = "InvalidNetworkError";
  }
}

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "regtest"];

function parseNetwork(value: string | undefined): Network {
  if (value === undefined || value === "") return DEFAULT_NETWORK;
  if ((NETWORKS as readonly string[]).includes(value)) return value as Network;
  throw new InvalidNetworkError(value);
}

/**
 * {@link ENV_MNEMONIC} carries the BIP-39 phrase that recovers both authors;
 * {@link ENV_PASSPHRASE} and {@link ENV_NETWORK} are optional. Network defaults
 * to testnet.
 */
export function loadWallet(env: Env = process.env): Wallet {
  const phrase = env[ENV_MNEMONIC]?.trim();
  if (!phrase) throw new MissingMnemonicError();
  const prefix = networkConfig(parseNetwork(env[ENV_NETWORK])).prefix;
  return Wallet.fromMnemonic(phrase, { prefix, passphrase: env[ENV_PASSPHRASE] || undefined });
}
