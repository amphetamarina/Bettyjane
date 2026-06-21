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
import { encrypted, memory, pin, pointer, text, type Memo, type MemoContent, type MemoKind } from "../../domain/memo";
import { encryptToPubkey } from "../../domain/crypto";
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
 * The write half: build, sign, and broadcast the transactions that mint and
 * forget memos. A memo coin is the memory and its OP_RETURN is the text. Coins
 * are told apart by value — memo coins hold exactly {@link DUST_SATS}, funding
 * coins hold more — and minting only spends funding, so it never disturbs an
 * existing memory.
 */

/** Output layout: the OP_RETURN first, the memo coin next, change last. */
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

  async mint(memo: Memo, signer: Signer): Promise<MintResult> {
    const ownerScript = Address.fromCashAddress(signer.address).toScript();
    const funding = await this.fundingCoins(signer.address);

    const tx = new TxBuilder({
      inputs: this.signedInputs(funding, signer, ownerScript),
      outputs: [
        { sats: 0n, script: this.authoredMemo(memo, signer) },
        { sats: DUST_SATS, script: ownerScript },
        ownerScript, // change, dropped into the fee if below dust
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memo };
  }

  /**
   * Mint a memo as pure data: an OP_RETURN with change only, no dust coin, so it
   * never joins the live set. Used for the chunks a large memory is split across.
   */
  async mintData(memo: Memo, signer: Signer): Promise<MintResult> {
    const ownerScript = Address.fromCashAddress(signer.address).toScript();
    const funding = await this.fundingCoins(signer.address);

    const tx = new TxBuilder({
      inputs: this.signedInputs(funding, signer, ownerScript),
      outputs: [
        { sats: 0n, script: encodeMemo(memo) },
        ownerScript, // change only; no dust coin means nothing joins the live set
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memo };
  }

  /**
   * Mint a memory-kind coin carrying `value`. A note that fits one OP_RETURN is
   * stored inline; a longer one is split across chunk transactions with the coin
   * holding a pointer to them. A note too long even for that is rejected.
   */
  async remember(value: string, signer: Signer): Promise<MintResult> {
    return this.writeText("memory", value, signer);
  }

  /**
   * Encrypt `value` to `recipientPubkey` and mint it as an encrypted memory coin,
   * readable only by the holder of the matching secret key. The blob must fit one
   * inline payload — encrypted notes are not split across a pointer chain.
   */
  async rememberPrivate(
    value: string,
    recipientPubkey: Uint8Array,
    signer: Signer,
  ): Promise<MintResult> {
    const ciphertext = encryptToPubkey(new TextEncoder().encode(value), recipientPubkey);
    if (ciphertext.length > MAX_PAYLOAD_BYTES) {
      throw new MemoTooLargeError(ciphertext.length, MAX_PAYLOAD_BYTES);
    }
    return this.mint(memory(encrypted(ciphertext)), signer);
  }

  /** Mint a pin-kind coin carrying `value`, the human's durable counterpart to remember. */
  async pin(value: string, signer: Signer): Promise<MintResult> {
    return this.writeText("pin", value, signer);
  }

  /** Drop a pin by spending its coin; the human's counterpart to forget. */
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

  /** Forget a memory by spending the coin its id names. */
  async forget(id: string, signer: Signer): Promise<SpendResult> {
    return this.spend(parseCoinId(id), signer);
  }

  /**
   * Mint several memos in order. Each spends the change the previous left, so
   * they must run sequentially, not in parallel.
   */
  async mintAll(memos: readonly Memo[], signer: Signer): Promise<MintResult[]> {
    const results: MintResult[] = [];
    for (const memo of memos) {
      results.push(await this.mint(memo, signer));
    }
    return results;
  }

  /**
   * Mint several memos in one transaction as eMPP sections, one dust coin each at
   * vouts 1..N so every note stays independently forgettable. Throws if they do
   * not fit one OP_RETURN — use {@link Minter.rememberBatch} to pack them first.
   */
  async mintBatch(memos: readonly Memo[], signer: Signer): Promise<MintBatchResult> {
    const ownerScript = Address.fromCashAddress(signer.address).toScript();
    const funding = await this.fundingCoins(signer.address);
    const dustCoins = memos.map(() => ({ sats: DUST_SATS, script: ownerScript }));

    const tx = new TxBuilder({
      inputs: this.signedInputs(funding, signer, ownerScript),
      outputs: [
        { sats: 0n, script: encodeMemoBatch(memos) },
        ...dustCoins,
        ownerScript,
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memos };
  }

  /**
   * Pack notes into eMPP batches that each fit one OP_RETURN and mint one
   * transaction per batch. Each note must fit a single section; a longer one
   * throws — use {@link Minter.remember}, which splits across a pointer chain.
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
   * Spend a memo coin to drop it from the live set, sweeping its value and a
   * funding coin back as change. No OP_RETURN: the spend itself is the record,
   * and other coins at the address are left untouched.
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
      outputs: [ownerScript], // reclaimed value, swept back as funding
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, outpoint };
  }

  /**
   * Sign inline text within {@link MAX_SIGNED_PAYLOAD_BYTES} as a v2 memo, so its
   * authorship is provable from the coin; pointer heads and longer notes fall
   * back to unsigned v1.
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
