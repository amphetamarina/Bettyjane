import { ChronikClient } from "chronik-client";
import {
  assessFunding,
  type FundingCoin,
  type FundingPolicy,
  type FundingStatus,
} from "../../domain/funding";
import { networkConfig, type Network, type NetworkConfig } from "./network";

/**
 * Reads the agent's memory address from the chain to answer one question:
 * is it funded yet? This is the observe half of bootstrap — funding the
 * address (sending it XEC from a wallet or faucet) happens out of band; here we
 * watch for the coins to arrive and confirm the address is ready to write.
 */

/** Chronik in mempool reports an unconfirmed UTXO's block height as this. */
const MEMPOOL_BLOCK_HEIGHT = -1;

/** The slice of Chronik this gateway depends on; satisfied by {@link ChronikClient}. */
export interface UtxoSource {
  address(address: string): {
    utxos(): Promise<{ utxos: readonly { sats: bigint; blockHeight: number }[] }>;
  };
}

export class FundingTimeoutError extends Error {
  constructor(
    readonly address: string,
    readonly elapsedMs: number,
    readonly status: FundingStatus,
  ) {
    super(`address ${address} not funded after ${elapsedMs}ms (${status.totalSats} sats seen)`);
    this.name = "FundingTimeoutError";
  }
}

export interface AwaitFundingOptions {
  /** How long to wait between polls. Default 5000ms. */
  readonly pollIntervalMs?: number;
  /** Give up after this long; omit to wait indefinitely. */
  readonly timeoutMs?: number;
  /** Cancel the wait early. */
  readonly signal?: AbortSignal;
  /** Injected clock/sleep, for tests; defaults to the real ones. */
  readonly clock?: Clock;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export class ChronikGateway {
  constructor(private readonly source: UtxoSource) {}

  static fromNetwork(network?: Network | NetworkConfig): ChronikGateway {
    const config = typeof network === "object" ? network : networkConfig(network);
    return new ChronikGateway(new ChronikClient([...config.chronikUrls]));
  }

  async coins(address: string): Promise<FundingCoin[]> {
    const { utxos } = await this.source.address(address).utxos();
    return utxos.map((utxo) => ({
      sats: utxo.sats,
      confirmed: utxo.blockHeight !== MEMPOOL_BLOCK_HEIGHT,
    }));
  }

  async fundingStatus(address: string, policy: FundingPolicy): Promise<FundingStatus> {
    return assessFunding(await this.coins(address), policy);
  }

  /** Poll until the address is funded under `policy`, or the timeout/signal fires. */
  async awaitFunding(
    address: string,
    policy: FundingPolicy,
    options: AwaitFundingOptions = {},
  ): Promise<FundingStatus> {
    const { pollIntervalMs = 5000, timeoutMs, signal } = options;
    const clock = options.clock ?? systemClock;
    const start = clock.now();

    for (;;) {
      signal?.throwIfAborted();
      const status = await this.fundingStatus(address, policy);
      if (status.funded) return status;

      const elapsed = clock.now() - start;
      if (timeoutMs !== undefined && elapsed + pollIntervalMs > timeoutMs) {
        throw new FundingTimeoutError(address, elapsed, status);
      }
      await clock.sleep(pollIntervalMs, signal);
    }
  }
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};
