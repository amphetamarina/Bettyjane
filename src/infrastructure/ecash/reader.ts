import { Script, fromHex, toHex } from "ecash-lib";
import { ChronikClient } from "chronik-client";
import type { Memo } from "../../domain/memo.js";
import { decodeMemo } from "./memo-codec.js";
import { DUST_SATS, TXID_BYTES } from "./protocol.js";
import { MalformedMemoError } from "./errors.js";
import { networkConfig, type Network, type NetworkConfig } from "./network.js";

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

  /**
   * The full text of a live memory. An inline text coin returns its text
   * directly; a pointer coin names its chunk transactions, so this fetches each
   * chunk in order and concatenates them back into the original note. The chunk
   * transactions carry no live coin of their own — they are reachable only
   * through the pointer.
   */
  async resolveText(coin: LiveCoin): Promise<string> {
    if (coin.memo.content.type === "text") return coin.memo.content.text;
    const txids = splitTxids(coin.memo.content.pointer);
    const chunks = await Promise.all(txids.map((txid) => this.chunkText(txid)));
    return chunks.join("");
  }

  private async chunkText(txid: string): Promise<string> {
    const memo = firstMemo(await this.source.outputScripts(txid));
    if (!memo || memo.content.type !== "text") {
      throw new MalformedMemoError(`pointer chunk ${txid} is not text`);
    }
    return memo.content.text;
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

function splitTxids(pointer: Uint8Array): string[] {
  if (pointer.length === 0 || pointer.length % TXID_BYTES !== 0) {
    throw new MalformedMemoError(`pointer payload is ${pointer.length} bytes, not a run of txids`);
  }
  const txids: string[] = [];
  for (let i = 0; i < pointer.length; i += TXID_BYTES) {
    txids.push(toHex(pointer.subarray(i, i + TXID_BYTES)));
  }
  return txids;
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
