import {
  Address,
  DEFAULT_PREFIX,
  HdNode,
  entropyToMnemonic,
  mnemonicToSeed,
  sha256,
  strToBytes,
} from "ecash-lib";
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

/**
 * The default memory namespace: the BIP-44 address index 0, i.e. the single
 * address each author has always used. Naming no namespace resolves here, so the
 * default path is byte-for-byte the original one.
 */
export const DEFAULT_NAMESPACE = "";

/**
 * Map a namespace name to a BIP-44 address index (AMP-243). Namespaces partition
 * an author's memory into separate, independently watchable addresses while
 * keeping the two-author split on the account level. The mapping is a pure
 * function of the name — no registry to keep in sync — so the same name always
 * derives the same address. The default namespace is index 0; every other name
 * hashes into the non-hardened index range and is bumped off 0 so it can never
 * alias the default. A collision between two distinct names is a 1-in-2^31 event.
 */
export function namespaceIndex(name: string): number {
  if (name === DEFAULT_NAMESPACE) return 0;
  const hash = sha256(strToBytes(name));
  const index = new DataView(hash.buffer, hash.byteOffset, 4).getUint32(0) & 0x7fffffff;
  return index === 0 ? 1 : index;
}

export const derivationPath = (author: Author, addressIndex = 0): string =>
  `m/44'/${XEC_COIN_TYPE}'/${ACCOUNT_BY_AUTHOR[author]}'/0/${addressIndex}`;

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

/**
 * Everything needed to author a write from one account: where its coins live
 * and the key that spends them. The union of an {@link Account}'s address and a
 * {@link SigningKey}, in the shape a minter consumes.
 */
export interface Signer {
  readonly address: string;
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

  account(author: Author, namespace: string = DEFAULT_NAMESPACE): Account {
    const node = this.nodeOf(author, namespace);
    return {
      author,
      path: derivationPath(author, namespaceIndex(namespace)),
      pubkey: node.pubkey(),
      address: Address.p2pkh(node.pkh(), this.prefix).toString(),
    };
  }

  address(author: Author, namespace: string = DEFAULT_NAMESPACE): string {
    return Address.p2pkh(this.nodeOf(author, namespace).pkh(), this.prefix).toString();
  }

  signingKey(author: Author, namespace: string = DEFAULT_NAMESPACE): SigningKey {
    const node = this.nodeOf(author, namespace);
    const seckey = node.seckey();
    if (!seckey) throw new Error(`no private key for the ${author} account`);
    return { seckey, pubkey: node.pubkey() };
  }

  /** The author's address and key together, ready to hand to a minter. */
  signer(author: Author, namespace: string = DEFAULT_NAMESPACE): Signer {
    const node = this.nodeOf(author, namespace);
    const seckey = node.seckey();
    if (!seckey) throw new Error(`no private key for the ${author} account`);
    return {
      address: Address.p2pkh(node.pkh(), this.prefix).toString(),
      seckey,
      pubkey: node.pubkey(),
    };
  }

  private nodeOf(author: Author, namespace: string = DEFAULT_NAMESPACE): HdNode {
    return this.master.derivePath(derivationPath(author, namespaceIndex(namespace)));
  }
}
