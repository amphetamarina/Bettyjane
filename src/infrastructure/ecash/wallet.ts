import { Address, DEFAULT_PREFIX, HdNode, entropyToMnemonic, mnemonicToSeed } from "ecash-lib";
import wordlist from "ecash-lib/wordlists/english.json" with { type: "json" };
import type { Author } from "../../domain/author";

/** eCash's registered BIP-44 coin type (SLIP-0044). */
export const XEC_COIN_TYPE = 1899;

/**
 * The agent and human are two independent BIP-44 accounts under one seed: the
 * agent owns account 0, the human account 1. One backup phrase recovers both
 * keys, yet each address is controlled by a distinct key.
 */
const ACCOUNT_BY_AUTHOR: Record<Author, number> = { agent: 0, human: 1 };

export const derivationPath = (author: Author): string =>
  `m/44'/${XEC_COIN_TYPE}'/${ACCOUNT_BY_AUTHOR[author]}'/0/0`;

const VALID_ENTROPY_BITS = [128, 160, 192, 224, 256] as const;
type EntropyBits = (typeof VALID_ENTROPY_BITS)[number];

export class InvalidEntropyError extends Error {
  constructor(readonly bits: number) {
    super(`entropy strength must be one of ${VALID_ENTROPY_BITS.join(", ")} bits, got ${bits}`);
    this.name = "InvalidEntropyError";
  }
}

/** A fresh BIP-39 mnemonic from cryptographically random entropy (128 bits = 12 words). */
export function generateMnemonic(strengthBits: EntropyBits = 128): string {
  if (!VALID_ENTROPY_BITS.includes(strengthBits)) throw new InvalidEntropyError(strengthBits);
  const entropy = crypto.getRandomValues(new Uint8Array(strengthBits / 8));
  return entropyToMnemonic(entropy, wordlist);
}

/** The key material needed to spend an author's coins (sign a transaction). */
export interface SigningKey {
  readonly seckey: Uint8Array;
  readonly pubkey: Uint8Array;
}

/** An author's derived account: where its coins live and how to recognize them. */
export interface Account {
  readonly author: Author;
  readonly path: string;
  readonly pubkey: Uint8Array;
  readonly address: string;
}

export interface WalletOptions {
  /** Cashaddr prefix; "ecash" (mainnet) by default, "ectest" for testnet. */
  readonly prefix?: string;
}

export interface FromMnemonicOptions extends WalletOptions {
  readonly passphrase?: string;
}

/**
 * Derives and manages the agent's and human's keys and memory/pin addresses from
 * one seed. See {@link derivationPath} for how the two authors are separated.
 */
export class Wallet {
  private constructor(
    private readonly master: HdNode,
    private readonly prefix: string,
  ) {}

  static fromMnemonic(phrase: string, options: FromMnemonicOptions = {}): Wallet {
    return Wallet.fromSeed(mnemonicToSeed(phrase, options.passphrase), options);
  }

  static fromSeed(seed: Uint8Array, options: WalletOptions = {}): Wallet {
    return new Wallet(HdNode.fromSeed(seed), options.prefix ?? DEFAULT_PREFIX);
  }

  account(author: Author): Account {
    const node = this.nodeOf(author);
    return {
      author,
      path: derivationPath(author),
      pubkey: node.pubkey(),
      address: Address.p2pkh(node.pkh(), this.prefix).toString(),
    };
  }

  address(author: Author): string {
    return Address.p2pkh(this.nodeOf(author).pkh(), this.prefix).toString();
  }

  signingKey(author: Author): SigningKey {
    const node = this.nodeOf(author);
    const seckey = node.seckey();
    if (!seckey) throw new Error(`no private key for the ${author} account`);
    return { seckey, pubkey: node.pubkey() };
  }

  private nodeOf(author: Author): HdNode {
    return this.master.derivePath(derivationPath(author));
  }
}
