import { Script, fromHex } from "ecash-lib";
import { ChronikClient } from "chronik-client";
import type { Memo } from "../../domain/memo";
import { decodeMemo } from "./memo-codec";
import { DUST_SATS } from "./protocol";
import { networkConfig, type Network, type NetworkConfig } from "./network";

/**
 * Reading the live memory: the unspent dust coins at an address are what the
 * team remembers now. This is the read half of the system. Spending a memo coin
 * (forgetting) removes it from this set; the chain keeps the history.
 *
 * Memo coins hold exactly {@link DUST_SATS}, so they are told apart from
 * funding/change coins by value alone — we only fetch a coin's transaction when
 * its value marks it as a candidate memory, and skip the foreign dust whose
 * transaction carries no Bettyjane memo.
 */

/** Chronik in mempool reports an unconfirmed UTXO's block height as this. */
const MEMPOOL_BLOCK_HEIGHT = -1;

/** An unspent output at an address: where the coin sits and how much it holds. */
export interface UnspentCoin {
  readonly outpoint: { readonly txid: string; readonly outIdx: number };
  readonly sats: bigint;
  readonly blockHeight: number;
}

/** The reads the reader needs: an address's UTXOs and a transaction's outputs. */
export interface MemoCoinSource {
  utxos(address: string): Promise<readonly UnspentCoin[]>;
  outputScripts(txid: string): Promise<readonly Script[]>;
}

/** A live memory: the coin that anchors it and the memo it carries. */
export interface LiveCoin {
  readonly outpoint: { readonly txid: string; readonly outIdx: number };
  readonly sats: bigint;
  readonly memo: Memo;
  readonly confirmed: boolean;
}

export class MemoReader {
  constructor(private readonly source: MemoCoinSource) {}

  /** Build a reader over a network's Chronik endpoints. */
  static fromNetwork(network?: Network | NetworkConfig): MemoReader {
    const config = typeof network === "object" ? network : networkConfig(network);
    const client = new ChronikClient([...config.chronikUrls]);
    const source: MemoCoinSource = {
      utxos: async (address) => {
        const { utxos } = await client.address(address).utxos();
        return utxos.map((utxo) => ({
          outpoint: utxo.outpoint,
          sats: utxo.sats,
          blockHeight: utxo.blockHeight,
        }));
      },
      outputScripts: async (txid) => {
        const tx = await client.tx(txid);
        return tx.outputs.map((output) => new Script(fromHex(output.outputScript)));
      },
    };
    return new MemoReader(source);
  }

  /** The live memory at an address: every unspent memo coin, decoded. */
  async listLiveCoins(address: string): Promise<LiveCoin[]> {
    const utxos = await this.source.utxos(address);
    const candidates = utxos.filter((coin) => coin.sats === DUST_SATS);
    const coins = await Promise.all(candidates.map((coin) => this.toLiveCoin(coin)));
    return coins.filter((coin): coin is LiveCoin => coin !== null);
  }

  private async toLiveCoin(coin: UnspentCoin): Promise<LiveCoin | null> {
    const memo = firstMemo(await this.source.outputScripts(coin.outpoint.txid));
    if (!memo) return null;
    return {
      outpoint: coin.outpoint,
      sats: coin.sats,
      memo,
      confirmed: coin.blockHeight !== MEMPOOL_BLOCK_HEIGHT,
    };
  }
}

function firstMemo(scripts: readonly Script[]): Memo | null {
  for (const script of scripts) {
    try {
      const memo = decodeMemo(script);
      if (memo) return memo;
    } catch {
      // A malformed BJNE script is not a usable memory; skip it.
    }
  }
  return null;
}
