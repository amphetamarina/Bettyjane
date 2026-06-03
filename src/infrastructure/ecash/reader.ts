import { Ecc, Script, fromHex, toHex } from "ecash-lib";
import { ChronikClient } from "chronik-client";
import type { Memo } from "../../domain/memo.js";
import { decodeMemo, decodeMemoBatch, verifyMemoAuthor } from "./memo-codec.js";
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

/** What an encrypted memory resolves to without a key; decryption is keyed and separate. */
const ENCRYPTED_PLACEHOLDER = "[encrypted]";

/** An unspent output at an address: where the coin sits and how much it holds. */
export interface UnspentCoin {
  readonly outpoint: { readonly txid: string; readonly outIdx: number };
  readonly sats: bigint;
  readonly blockHeight: number;
}

/** One output of a transaction in an address's history: its script, value, and whether it has been spent. */
export interface HistoryOutput {
  readonly script: Script;
  readonly sats: bigint;
  readonly spent: boolean;
}

/** A transaction in an address's history, with enough to reconstruct its memo coins. */
export interface AddressTx {
  readonly txid: string;
  readonly blockHeight: number;
  readonly outputs: readonly HistoryOutput[];
}

/** The reads the reader needs: an address's UTXOs, a transaction's outputs, and (for history) its full tx list. */
export interface MemoCoinSource {
  utxos(address: string): Promise<readonly UnspentCoin[]>;
  outputScripts(txid: string): Promise<readonly Script[]>;
  /** Every transaction touching the address, newest first; required for {@link MemoReader.listAllCoins}. */
  history?(address: string): Promise<readonly AddressTx[]>;
}

/** A live memory: the coin that anchors it and the memo it carries. */
export interface LiveCoin {
  readonly outpoint: { readonly txid: string; readonly outIdx: number };
  readonly sats: bigint;
  readonly memo: Memo;
  readonly blockHeight: number;
  readonly confirmed: boolean;
  /**
   * Whether the memo carries a valid author signature for this coin (AMP-239).
   * True for a signed v2 memo whose recovered signer matches the coin's address;
   * false for an unsigned v1 memo or a signature that does not verify.
   */
  readonly authorVerified: boolean;
}

/** A memory across all of history: a {@link LiveCoin} plus whether its coin has been spent (forgotten). */
export interface HistoricalCoin extends LiveCoin {
  readonly spent: boolean;
}

/** Pages of address history to read at most, bounding work on a long-lived address. */
const MAX_HISTORY_PAGES = 20;
const HISTORY_PAGE_SIZE = 200;

export class MemoReader {
  constructor(
    private readonly source: MemoCoinSource,
    private readonly ecc: Ecc = new Ecc(),
  ) {}

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
      history: async (address) => {
        const txs: AddressTx[] = [];
        let page = 0;
        let numPages = 1;
        do {
          const result = await client.address(address).history(page, HISTORY_PAGE_SIZE);
          numPages = result.numPages;
          for (const tx of result.txs) {
            txs.push({
              txid: tx.txid,
              blockHeight: tx.block?.height ?? MEMPOOL_BLOCK_HEIGHT,
              outputs: tx.outputs.map((output) => ({
                script: new Script(fromHex(output.outputScript)),
                sats: output.sats,
                spent: output.spentBy !== undefined,
              })),
            });
          }
          page += 1;
        } while (page < numPages && page < MAX_HISTORY_PAGES);
        return txs;
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
   * Every memory ever minted at an address, live and forgotten — the full album,
   * not just the coins on the table now. Reconstructed from the address's
   * transaction history: each memo coin (a dust output carrying a Bettyjane memo)
   * becomes a {@link HistoricalCoin} flagged `spent` if its coin has since been
   * forgotten. Newest first. Bounded to the most recent {@link MAX_HISTORY_PAGES}
   * pages of history.
   */
  async listAllCoins(address: string): Promise<HistoricalCoin[]> {
    if (!this.source.history) {
      throw new Error("this reader's source has no history(); use a network-backed MemoReader");
    }
    const txs = await this.source.history(address);
    const coins: HistoricalCoin[] = [];
    for (const tx of txs) {
      const scripts = tx.outputs.map((output) => output.script);
      tx.outputs.forEach((output, outIdx) => {
        if (output.sats !== DUST_SATS) return; // only dust memo coins anchor a memory
        const memo = this.memoForCoin(scripts, outIdx);
        if (!memo) return;
        coins.push({
          outpoint: { txid: tx.txid, outIdx },
          sats: output.sats,
          memo: memo.memo,
          blockHeight: tx.blockHeight,
          confirmed: tx.blockHeight !== MEMPOOL_BLOCK_HEIGHT,
          authorVerified: memo.authorVerified,
          spent: output.spent,
        });
      });
    }
    return coins;
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
    if (coin.memo.content.type === "encrypted") return ENCRYPTED_PLACEHOLDER;
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
    const scripts = await this.source.outputScripts(coin.outpoint.txid);
    const memo = this.memoForCoin(scripts, coin.outpoint.outIdx);
    if (!memo) return null;
    return {
      outpoint: coin.outpoint,
      sats: coin.sats,
      memo: memo.memo,
      blockHeight: coin.blockHeight,
      confirmed: coin.blockHeight !== MEMPOOL_BLOCK_HEIGHT,
      authorVerified: memo.authorVerified,
    };
  }

  /**
   * The memo a dust coin carries. A batched transaction (AMP-240) holds an eMPP
   * OP_RETURN at output 0 and one dust coin per section at outputs 1..N, so the
   * coin at outIdx k maps to section k-1. A single-memo transaction uses the lone
   * OP_RETURN. Batched sections are unsigned, so only single signed memos report
   * authorVerified.
   */
  private memoForCoin(
    scripts: readonly Script[],
    outIdx: number,
  ): { memo: Memo; authorVerified: boolean } | null {
    const opReturn = scripts[0];
    const batch = opReturn ? decodeMemoBatch(opReturn) : null;
    if (batch) {
      const memo = batch[outIdx - 1];
      return memo ? { memo, authorVerified: false } : null;
    }
    const memoScript = firstMemoScript(scripts);
    if (!memoScript) return null;
    const ownerScript = scripts[outIdx];
    return {
      memo: memoScript.memo,
      authorVerified: ownerScript
        ? verifyMemoAuthor(memoScript.script, ownerScript.bytecode, this.ecc)
        : false,
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
  return firstMemoScript(scripts)?.memo ?? null;
}

function firstMemoScript(scripts: readonly Script[]): { memo: Memo; script: Script } | null {
  for (const script of scripts) {
    try {
      const memo = decodeMemo(script);
      if (memo) return { memo, script };
    } catch {
      // A malformed BJNE script is not a usable memory; skip it.
    }
  }
  return null;
}
