import {
  ALL_BIP143,
  Address,
  DEFAULT_FEE_SATS_PER_KB,
  DEFAULT_PREFIX,
  Ecc,
  Script,
  type Signatory,
  TxBuilder,
  flagSignature,
  sha256d,
  shaRmd160,
  toHex,
} from "ecash-lib";
import { ChronikClient } from "chronik-client";
import type { Memo } from "../../domain/memo";
import { encodeMemo } from "./memo-codec";
import { DUST_SATS } from "./protocol";
import { networkConfig, type Network, type NetworkConfig } from "./network";
import {
  type Broadcaster,
  type CoinSource,
  InsufficientFundsError,
  MemoCoinNotFoundError,
  type MintResult,
  type SpendableCoin,
  type SpendResult,
} from "./minter";

/**
 * Consensus memories: a coin at a 2-of-2 P2SH address derived from both pubkeys,
 * so writing or forgetting needs both signatures. The 2-of-2 script is the
 * enforcement; the CONSENSUS kind only labels it. Both keys come from one
 * mnemonic, so the signatures are made together rather than handed over as a PSBT.
 *
 * eCash has P2SH20 only, so the address is a hash160 of the redeem script. That
 * is fine for a 2-of-2 between two known keys; the P2SH32 collision concern does
 * not apply.
 */

const TWO_OF_TWO = 2;

/** One party to a consensus coin: its public key, and the secret key to sign with. */
export interface ConsensusSigner {
  readonly pubkey: Uint8Array;
  readonly seckey: Uint8Array;
}

/** Order pubkeys deterministically so the redeem script and address are stable. */
function ordered<T extends { pubkey: Uint8Array } | Uint8Array>(items: readonly T[]): T[] {
  const keyOf = (item: T): string => toHex(item instanceof Uint8Array ? item : item.pubkey);
  return [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/** The 2-of-2 multisig redeem script over the two public keys, in canonical order. */
export function consensusRedeemScript(pubkeys: readonly Uint8Array[]): Script {
  if (pubkeys.length !== TWO_OF_TWO) {
    throw new Error(`a consensus coin needs exactly ${TWO_OF_TWO} pubkeys, got ${pubkeys.length}`);
  }
  return Script.multisig(TWO_OF_TWO, ordered(pubkeys));
}

/** The 20-byte P2SH script hash of the consensus redeem script. */
export function consensusScriptHash(pubkeys: readonly Uint8Array[]): Uint8Array {
  return shaRmd160(consensusRedeemScript(pubkeys).bytecode);
}

/** The cashaddr P2SH address where consensus coins live. */
export function consensusAddress(pubkeys: readonly Uint8Array[], prefix: string = DEFAULT_PREFIX): string {
  return Address.p2sh(consensusScriptHash(pubkeys), prefix).toString();
}

/**
 * A signatory that spends a 2-of-2 consensus coin by signing the input with both
 * keys, in the same order the pubkeys appear in the redeem script (OP_CHECKMULTISIG
 * requires that order).
 */
export function consensusSignatory(signers: readonly ConsensusSigner[]): Signatory {
  const parties = ordered(signers);
  const redeemScript = Script.multisig(
    TWO_OF_TWO,
    parties.map((p) => p.pubkey),
  );
  return (ecc, input) => {
    const sighash = sha256d(input.sigHashPreimage(ALL_BIP143).bytes);
    const signatures = parties.map((p) => flagSignature(ecc.ecdsaSign(p.seckey, sighash), ALL_BIP143));
    return Script.multisigSpend({ signatures, redeemScript });
  };
}

export interface ConsensusMinterOptions {
  readonly feePerKb?: bigint;
  readonly ecc?: Ecc;
}

/** Mints and forgets consensus memories, spending the 2-of-2 coin with both keys. */
export class ConsensusMinter {
  private readonly feePerKb: bigint;
  private readonly ecc: Ecc;

  constructor(
    private readonly coins: CoinSource,
    private readonly broadcaster: Broadcaster,
    options: ConsensusMinterOptions = {},
  ) {
    this.feePerKb = options.feePerKb ?? DEFAULT_FEE_SATS_PER_KB;
    this.ecc = options.ecc ?? new Ecc();
  }

  /** Build a consensus minter over a network's Chronik endpoints. */
  static fromNetwork(network?: Network | NetworkConfig, options: ConsensusMinterOptions = {}): ConsensusMinter {
    const config = typeof network === "object" ? network : networkConfig(network);
    const client = new ChronikClient([...config.chronikUrls]);
    const coins: CoinSource = {
      spendableCoins: async (address) => {
        const { utxos } = await client.address(address).utxos();
        return utxos.map((utxo) => ({ outpoint: utxo.outpoint, sats: utxo.sats }));
      },
    };
    const broadcaster: Broadcaster = { broadcast: (rawTx) => client.broadcastTx(rawTx) };
    return new ConsensusMinter(coins, broadcaster, options);
  }

  /** The 2-of-2 address these signers control; fund it before minting. */
  address(signers: readonly ConsensusSigner[], prefix?: string): string {
    return consensusAddress(
      signers.map((s) => s.pubkey),
      prefix,
    );
  }

  /** Mint a consensus memo, signed by both parties, at their 2-of-2 address. */
  async mint(memo: Memo, signers: readonly ConsensusSigner[], prefix?: string): Promise<MintResult> {
    const redeemScript = consensusRedeemScript(signers.map((s) => s.pubkey));
    const p2sh = Script.p2sh(shaRmd160(redeemScript.bytecode));
    const address = this.address(signers, prefix);
    const funding = await this.fundingCoins(address);

    const tx = new TxBuilder({
      inputs: this.inputs(funding, signers, redeemScript),
      outputs: [
        { sats: 0n, script: encodeMemo(memo) },
        { sats: DUST_SATS, script: p2sh },
        p2sh,
      ],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, memo };
  }

  /** Forget a consensus memo by spending its coin, signed by both parties. */
  async forget(
    outpoint: { readonly txid: string; readonly outIdx: number },
    signers: readonly ConsensusSigner[],
    prefix?: string,
  ): Promise<SpendResult> {
    const redeemScript = consensusRedeemScript(signers.map((s) => s.pubkey));
    const p2sh = Script.p2sh(shaRmd160(redeemScript.bytecode));
    const address = this.address(signers, prefix);
    const coins = await this.coins.spendableCoins(address);
    const target = coins.find((c) => c.outpoint.txid === outpoint.txid && c.outpoint.outIdx === outpoint.outIdx);
    if (!target) throw new MemoCoinNotFoundError(outpoint);
    const funding = coins.filter((c) => c.sats > DUST_SATS && c !== target);

    const tx = new TxBuilder({
      inputs: this.inputs([target, ...funding], signers, redeemScript),
      outputs: [p2sh],
    }).sign({ ecc: this.ecc, feePerKb: this.feePerKb, dustSats: DUST_SATS });

    const rawTx = tx.ser();
    const { txid } = await this.broadcaster.broadcast(rawTx);
    return { txid, rawTx, outpoint };
  }

  private inputs(coins: readonly SpendableCoin[], signers: readonly ConsensusSigner[], redeemScript: Script) {
    const signatory = consensusSignatory(signers);
    return coins.map((coin) => ({
      input: { prevOut: coin.outpoint, signData: { sats: coin.sats, redeemScript } },
      signatory,
    }));
  }

  private async fundingCoins(address: string): Promise<SpendableCoin[]> {
    const coins = await this.coins.spendableCoins(address);
    const funding = coins.filter((c) => c.sats > DUST_SATS);
    if (funding.length === 0) {
      throw new InsufficientFundsError(address, coins.reduce((sum, c) => sum + c.sats, 0n));
    }
    return funding.sort((a, b) => (a.sats < b.sats ? 1 : a.sats > b.sats ? -1 : 0));
  }
}
