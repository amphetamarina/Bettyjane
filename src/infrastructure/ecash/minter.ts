import {
  ALL_BIP143,
  Address,
  DEFAULT_FEE_SATS_PER_KB,
  Ecc,
  P2PKHSignatory,
  Script,
  TxBuilder,
} from "ecash-lib";
import { ChronikClient } from "chronik-client";
import type { Memo } from "../../domain/memo";
import type { Signer } from "./wallet";
import { encodeMemo } from "./memo-codec";
import { DUST_SATS } from "./protocol";
import { networkConfig, type Network, type NetworkConfig } from "./network";

/**
 * Writing a memo is minting a coin: spend some of the author's funding XEC,
 * attach the memo as an OP_RETURN, and lay down a fresh dust coin that anchors
 * that memo to the author's address. The dust coin is the memory; the OP_RETURN
 * is its text. This module is the write half of the system — the first thing
 * that builds, signs, and broadcasts a transaction.
 *
 * Coins at the address come in two kinds, told apart by value alone: memo coins
 * hold exactly {@link DUST_SATS}, funding/change coins hold more. The minter
 * only ever spends the funding kind, so minting a new memory never disturbs an
 * existing one — forgetting (spending a memo coin) stays a separate, deliberate
 * act.
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
      inputs: funding.map((coin) => ({
        input: {
          prevOut: coin.outpoint,
          signData: { sats: coin.sats, outputScript: ownerScript },
        },
        signatory: P2PKHSignatory(signer.seckey, signer.pubkey, ALL_BIP143),
      })),
      outputs: [
        { sats: 0n, script: encodeMemo(memo) }, // OP_RETURN_VOUT: the memo text
        { sats: DUST_SATS, script: ownerScript }, // MEMO_COIN_VOUT: the memory
        ownerScript, // leftover change, dropped into the fee if below dust
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memo };
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

  private async fundingCoins(address: string): Promise<SpendableCoin[]> {
    const coins = await this.coins.spendableCoins(address);
    const funding = coins.filter((coin) => coin.sats > DUST_SATS);
    if (funding.length === 0) {
      const spendable = coins.reduce((total, coin) => total + coin.sats, 0n);
      throw new InsufficientFundsError(address, spendable);
    }
    // Largest first so a single coin usually covers the write deterministically.
    return funding.sort((a, b) => (a.sats < b.sats ? 1 : a.sats > b.sats ? -1 : 0));
  }
}

export { MEMO_COIN_VOUT, OP_RETURN_VOUT };
