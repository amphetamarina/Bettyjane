import {
  ALL_BIP143,
  Address,
  DEFAULT_FEE_SATS_PER_KB,
  Ecc,
  P2PKHSignatory,
  Script,
  TxBuilder,
  fromHex,
} from "ecash-lib";
import { ChronikClient } from "chronik-client";
import { memory, pin, pointer, text, type Memo, type MemoContent, type MemoKind } from "../../domain/memo";
import { parseCoinId } from "../../domain/coin-id";
import { chunkText } from "../../domain/chunking";
import type { Signer } from "./wallet";
import { batchMemos, encodeMemo, encodeMemoBatch, encodeSignedMemo, signingDigest } from "./memo-codec";
import {
  DUST_SATS,
  MAX_PAYLOAD_BYTES,
  MAX_POINTER_CHUNKS,
  MAX_SIGNED_PAYLOAD_BYTES,
  TXID_BYTES,
} from "./protocol";
import { MemoTooLargeError } from "./errors";
import { networkConfig, type Network, type NetworkConfig } from "./network";

/**
 * Writing a memo is minting a coin: spend some of the author's funding XEC,
 * attach the memo as an OP_RETURN, and lay down a fresh dust coin that anchors
 * that memo to the author's address. The dust coin is the memory; the OP_RETURN
 * is its text. This module is the write half of the system — the first thing
 * that builds, signs, and broadcasts a transaction.
 *
 * Coins at the address come in two kinds, told apart by value alone: memo coins
 * hold exactly {@link DUST_SATS}, funding/change coins hold more. Minting only
 * ever spends the funding kind, so a new memory never disturbs an existing one.
 * Forgetting is the opposite write — {@link Minter.spend} deliberately consumes
 * one memo coin to drop it from the live set, leaving every other coin alone.
 */

/** Where the OP_RETURN sits, the memo coin right after it, change last. */
const OP_RETURN_VOUT = 0;
const MEMO_COIN_VOUT = 1;

/** A spendable output the minter may consume to pay for a write. */
export interface SpendableCoin {
  readonly outpoint: { readonly txid: string; readonly outIdx: number };
  readonly sats: bigint;
}

/** The reads the minter needs: the spendable coins backing an address. */
export interface CoinSource {
  spendableCoins(address: string): Promise<readonly SpendableCoin[]>;
}

/** The write the minter needs: hand a signed transaction to the network. */
export interface Broadcaster {
  broadcast(rawTx: Uint8Array): Promise<{ txid: string }>;
}

export interface MinterOptions {
  /** Fee rate in sats per kB. Defaults to the eCash relay minimum. */
  readonly feePerKb?: bigint;
  /** Injected ECC backend; defaults to ecash-lib's native one. */
  readonly ecc?: Ecc;
}

/** The outcome of a mint: the new coin's transaction, raw and identified. */
export interface MintResult {
  readonly txid: string;
  readonly rawTx: Uint8Array;
  readonly memo: Memo;
}

/** The outcome of a batched mint: one transaction carrying several memo coins. */
export interface MintBatchResult {
  readonly txid: string;
  readonly rawTx: Uint8Array;
  readonly memos: readonly Memo[];
}

/** The outcome of a forget: the spend transaction and the coin it removed. */
export interface SpendResult {
  readonly txid: string;
  readonly rawTx: Uint8Array;
  readonly outpoint: { readonly txid: string; readonly outIdx: number };
}

/** Thrown when an address has no funding coin large enough to pay for a write. */
export class InsufficientFundsError extends Error {
  constructor(
    readonly address: string,
    readonly availableSats: bigint,
  ) {
    super(`address ${address} has no funding coins to mint with (${availableSats} spendable sats)`);
    this.name = "InsufficientFundsError";
  }
}

/** Thrown when the coin asked to be forgotten is not live at the author's address. */
export class MemoCoinNotFoundError extends Error {
  constructor(readonly outpoint: { readonly txid: string; readonly outIdx: number }) {
    super(`no live coin at ${outpoint.txid}:${outpoint.outIdx} to forget`);
    this.name = "MemoCoinNotFoundError";
  }
}

export class Minter {
  private readonly feePerKb: bigint;
  private readonly ecc: Ecc;

  constructor(
    private readonly coins: CoinSource,
    private readonly broadcaster: Broadcaster,
    options: MinterOptions = {},
  ) {
    this.feePerKb = options.feePerKb ?? DEFAULT_FEE_SATS_PER_KB;
    this.ecc = options.ecc ?? new Ecc();
  }

  /** Build a minter over a network's Chronik endpoints. */
  static fromNetwork(network?: Network | NetworkConfig, options: MinterOptions = {}): Minter {
    const config = typeof network === "object" ? network : networkConfig(network);
    const client = new ChronikClient([...config.chronikUrls]);
    const coins: CoinSource = {
      spendableCoins: async (address) => {
        const { utxos } = await client.address(address).utxos();
        return utxos.map((utxo) => ({ outpoint: utxo.outpoint, sats: utxo.sats }));
      },
    };
    const broadcaster: Broadcaster = { broadcast: (rawTx) => client.broadcastTx(rawTx) };
    return new Minter(coins, broadcaster, options);
  }

  /** Mint one memo as a coin signed by `signer`, and broadcast it. */
  async mint(memo: Memo, signer: Signer): Promise<MintResult> {
    const ownerScript = Address.fromCashAddress(signer.address).toScript();
    const funding = await this.fundingCoins(signer.address);

    const tx = new TxBuilder({
      inputs: this.signedInputs(funding, signer, ownerScript),
      outputs: [
        { sats: 0n, script: this.authoredMemo(memo, signer) }, // OP_RETURN_VOUT: the memo text
        { sats: DUST_SATS, script: ownerScript }, // MEMO_COIN_VOUT: the memory
        ownerScript, // leftover change, dropped into the fee if below dust
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memo };
  }

  /**
   * Mint a memo as pure data: an OP_RETURN with change only, no dust memo coin.
   * Used for the chunks a large memory is split across — each chunk carries text
   * but is not itself a live memory coin, so it never appears in the live set.
   * The pointer coin that names the chunks (see {@link Minter.remember}) is the
   * memory; the chunk text stays retrievable from the chain by txid forever.
   */
  async mintData(memo: Memo, signer: Signer): Promise<MintResult> {
    const ownerScript = Address.fromCashAddress(signer.address).toScript();
    const funding = await this.fundingCoins(signer.address);

    const tx = new TxBuilder({
      inputs: this.signedInputs(funding, signer, ownerScript),
      outputs: [
        { sats: 0n, script: encodeMemo(memo) }, // OP_RETURN: the chunk text
        ownerScript, // change; no dust coin, so this tx adds nothing to the live set
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memo };
  }

  /**
   * Remember a note: mint a memory-kind coin carrying `value`. The agent's write
   * verb — the mirror of {@link Minter.spend}, which forgets. The coin is laid
   * down at the signer's own address, so a remembered note is held by the same
   * key that can later forget it.
   *
   * A note that fits one OP_RETURN is stored inline as text. A longer one is
   * split into chunk transactions (see {@link Minter.mintData}) and the memory
   * coin becomes a pointer naming those chunks in order; the reader rejoins them.
   * A note too long even for the pointer's chunk capacity is rejected.
   */
  async remember(value: string, signer: Signer): Promise<MintResult> {
    return this.writeText("memory", value, signer);
  }

  /**
   * Pin a durable note: mint a pin-kind coin carrying `value`, signed by the
   * human key. The human's write verb, the mirror of {@link Minter.unpin}. Like
   * remember it stores a long note across a pointer chain, but pins are meant to
   * stay few and short.
   */
  async pin(value: string, signer: Signer): Promise<MintResult> {
    return this.writeText("pin", value, signer);
  }

  /**
   * Unpin a durable note by its id: the human's drop verb, the mirror of
   * {@link Minter.pin}. Identical to forgetting — it spends the named coin — but
   * named for the human side. The signature decides what may be spent: spend
   * only ever consults the signer's own address, so the human key drops pins and
   * the agent key drops memories; neither can spend the other's coins.
   */
  async unpin(id: string, signer: Signer): Promise<SpendResult> {
    return this.spend(parseCoinId(id), signer);
  }

  private async writeText(kind: MemoKind, value: string, signer: Signer): Promise<MintResult> {
    if (Buffer.byteLength(value, "utf8") <= MAX_PAYLOAD_BYTES) {
      return this.mint(withKind(kind, text(value)), signer);
    }
    const chunks = chunkText(value, MAX_PAYLOAD_BYTES);
    if (chunks.length > MAX_POINTER_CHUNKS) {
      throw new MemoTooLargeError(
        Buffer.byteLength(value, "utf8"),
        MAX_POINTER_CHUNKS * MAX_PAYLOAD_BYTES,
      );
    }
    const txids: string[] = [];
    for (const chunk of chunks) {
      const { txid } = await this.mintData(withKind(kind, text(chunk)), signer);
      txids.push(txid);
    }
    return this.mint(withKind(kind, pointer(concatTxids(txids))), signer);
  }

  /**
   * Forget a memory by its id: parse the `txid:outIdx` id into the outpoint it
   * names and spend that coin. The agent's drop verb, taking the same string id
   * a coin is minted or listed under, so an agent never handles a raw outpoint.
   */
  async forget(id: string, signer: Signer): Promise<SpendResult> {
    return this.spend(parseCoinId(id), signer);
  }

  /**
   * Mint several memos from one signer, in order. Each mint spends the change
   * the previous one left behind, so the coins must be minted sequentially, not
   * in parallel; the returned results follow the input order.
   */
  async mintAll(memos: readonly Memo[], signer: Signer): Promise<MintResult[]> {
    const results: MintResult[] = [];
    for (const memo of memos) {
      results.push(await this.mint(memo, signer));
    }
    return results;
  }

  /**
   * Mint several memos in one transaction via an eMPP batch (AMP-240): a single
   * OP_RETURN carries every memo as a section, and one dust coin is laid down per
   * section so each note stays an independently forgettable coin. The dust coins
   * sit at vouts 1..N, matching the section order. Throws if the memos do not fit
   * one OP_RETURN — pack with {@link Minter.rememberBatch} to avoid that.
   */
  async mintBatch(memos: readonly Memo[], signer: Signer): Promise<MintBatchResult> {
    const ownerScript = Address.fromCashAddress(signer.address).toScript();
    const funding = await this.fundingCoins(signer.address);
    const dustCoins = memos.map(() => ({ sats: DUST_SATS, script: ownerScript }));

    const tx = new TxBuilder({
      inputs: this.signedInputs(funding, signer, ownerScript),
      outputs: [
        { sats: 0n, script: encodeMemoBatch(memos) }, // OP_RETURN_VOUT: every memo
        ...dustCoins, // one dust memo coin per section, in order
        ownerScript, // change
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memos };
  }

  /**
   * Remember several notes with as few transactions as possible (AMP-240): pack
   * the notes into eMPP batches that each fit one OP_RETURN and mint one
   * transaction per batch, returning a result per transaction. Each note must fit
   * a single section ({@link MAX_PAYLOAD_BYTES}); a longer note throws — store it
   * with {@link Minter.remember}, which splits it across a pointer chain.
   */
  async rememberBatch(values: readonly string[], signer: Signer): Promise<MintBatchResult[]> {
    const memos = values.map((value) => withKind("memory", text(value)));
    const results: MintBatchResult[] = [];
    for (const batch of batchMemos(memos)) {
      results.push(await this.mintBatch(batch, signer));
    }
    return results;
  }

  /**
   * Forget a memory by spending its coin. The dust coin named by `outpoint`
   * leaves the live set, and its value plus a funding coin (to cover the fee) is
   * swept back to the author as change. Forgetting writes nothing to an
   * OP_RETURN — the spend transaction itself is the record of the change, and
   * the chain keeps the full history. Other memo coins at the address are never
   * touched.
   */
  async spend(
    outpoint: { readonly txid: string; readonly outIdx: number },
    signer: Signer,
  ): Promise<SpendResult> {
    const ownerScript = Address.fromCashAddress(signer.address).toScript();
    const coins = await this.coins.spendableCoins(signer.address);
    const target = coins.find((coin) => sameOutpoint(coin.outpoint, outpoint));
    if (!target) throw new MemoCoinNotFoundError(outpoint);
    const funding = this.selectFunding(coins, signer.address, target);

    const tx = new TxBuilder({
      inputs: this.signedInputs([target, ...funding], signer, ownerScript),
      outputs: [ownerScript], // the reclaimed value, swept back as funding
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, outpoint };
  }

  /**
   * Encode a memo for its OP_RETURN, signing the content when it fits (AMP-239).
   * An inline text note within {@link MAX_SIGNED_PAYLOAD_BYTES} is minted as a
   * signed v2 memo so its authorship is provable from the coin alone; pointer
   * heads and longer notes fall back to the unsigned v1 encoding.
   */
  private authoredMemo(memo: Memo, signer: Signer): Script {
    if (
      memo.content.type === "text" &&
      Buffer.byteLength(memo.content.text, "utf8") <= MAX_SIGNED_PAYLOAD_BYTES
    ) {
      const signature = this.ecc.signRecoverable(signer.seckey, signingDigest(memo));
      return encodeSignedMemo(memo, signature);
    }
    return encodeMemo(memo);
  }

  private signedInputs(coins: readonly SpendableCoin[], signer: Signer, ownerScript: Script) {
    return coins.map((coin) => ({
      input: {
        prevOut: coin.outpoint,
        signData: { sats: coin.sats, outputScript: ownerScript },
      },
      signatory: P2PKHSignatory(signer.seckey, signer.pubkey, ALL_BIP143),
    }));
  }

  private async fundingCoins(address: string): Promise<SpendableCoin[]> {
    return this.selectFunding(await this.coins.spendableCoins(address), address);
  }

  private selectFunding(
    coins: readonly SpendableCoin[],
    address: string,
    exclude?: SpendableCoin,
  ): SpendableCoin[] {
    const funding = coins.filter((coin) => coin.sats > DUST_SATS && coin !== exclude);
    if (funding.length === 0) {
      const spendable = coins.reduce((total, coin) => total + coin.sats, 0n);
      throw new InsufficientFundsError(address, spendable);
    }
    // Largest first so a single coin usually covers the write deterministically.
    return funding.sort((a, b) => (a.sats < b.sats ? 1 : a.sats > b.sats ? -1 : 0));
  }
}

function sameOutpoint(
  a: { readonly txid: string; readonly outIdx: number },
  b: { readonly txid: string; readonly outIdx: number },
): boolean {
  return a.txid === b.txid && a.outIdx === b.outIdx;
}

/** Wrap content in the memo of the given author kind. */
function withKind(kind: MemoKind, content: MemoContent): Memo {
  return kind === "pin" ? pin(content) : memory(content);
}

/** Pack chunk txids into one pointer payload: each txid as its 32 raw bytes, in order. */
function concatTxids(txids: readonly string[]): Uint8Array {
  const bytes = new Uint8Array(txids.length * TXID_BYTES);
  txids.forEach((txid, i) => bytes.set(fromHex(txid), i * TXID_BYTES));
  return bytes;
}

export { MEMO_COIN_VOUT, OP_RETURN_VOUT };
