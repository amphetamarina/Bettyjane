import { describe, expect, test } from "bun:test";
import { Ecc, mnemonicToEntropy } from "ecash-lib";
import wordlist from "ecash-lib/wordlists/english.json" with { type: "json" };
import {
  AUTHORS,
  DEFAULT_NAMESPACE,
  InvalidEntropyError,
  Wallet,
  derivationPath,
  generateMnemonic,
  namespaceIndex,
} from "../src/index";

// BIP-39 test vector; deterministic across runs.
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("derivation paths", () => {
  test("agent and human are separate BIP-44 accounts under XEC coin type", () => {
    expect(derivationPath("agent")).toBe("m/44'/1899'/0'/0/0");
    expect(derivationPath("human")).toBe("m/44'/1899'/1'/0/0");
  });

  test("a namespace index lands on the address-index path component", () => {
    expect(derivationPath("agent", 0)).toBe("m/44'/1899'/0'/0/0");
    expect(derivationPath("agent", 7)).toBe("m/44'/1899'/0'/0/7");
  });
});

describe("namespace indices (AMP-243)", () => {
  test("the default namespace is index 0", () => {
    expect(namespaceIndex(DEFAULT_NAMESPACE)).toBe(0);
  });

  test("a named namespace is deterministic and non-zero", () => {
    expect(namespaceIndex("billing")).toBe(namespaceIndex("billing"));
    expect(namespaceIndex("billing")).toBeGreaterThan(0);
  });

  test("distinct names derive distinct indices", () => {
    expect(namespaceIndex("billing")).not.toBe(namespaceIndex("infra"));
  });

  test("indices stay within the non-hardened range", () => {
    for (const name of ["billing", "infra", "a-very-long-namespace-name", "🪙"]) {
      const index = namespaceIndex(name);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(0x80000000);
    }
  });
});

describe("namespaced addresses (AMP-243)", () => {
  test("the default namespace reproduces the original address", () => {
    const wallet = Wallet.fromMnemonic(PHRASE);
    for (const author of AUTHORS) {
      expect(wallet.address(author, DEFAULT_NAMESPACE)).toBe(wallet.address(author));
      expect(wallet.account(author, DEFAULT_NAMESPACE).path).toBe(derivationPath(author, 0));
    }
  });

  test("a named namespace derives a different, watchable address", () => {
    const wallet = Wallet.fromMnemonic(PHRASE);
    const scoped = wallet.address("agent", "billing");
    expect(scoped).toMatch(/^ecash:q/);
    expect(scoped).not.toBe(wallet.address("agent"));
  });

  test("namespaced derivation is deterministic across wallets", () => {
    expect(Wallet.fromMnemonic(PHRASE).address("agent", "infra")).toBe(
      Wallet.fromMnemonic(PHRASE).address("agent", "infra"),
    );
  });

  test("the namespaced signer's key matches its account", () => {
    const wallet = Wallet.fromMnemonic(PHRASE);
    const signer = wallet.signer("agent", "billing");
    expect(signer.address).toBe(wallet.account("agent", "billing").address);
    expect(signer.pubkey).toEqual(wallet.account("agent", "billing").pubkey);
    expect(new Ecc().derivePubkey(signer.seckey)).toEqual(signer.pubkey);
  });
});

describe("a wallet from a mnemonic", () => {
  test("derives a distinct memory and pin address", () => {
    const wallet = Wallet.fromMnemonic(PHRASE);
    const agent = wallet.account("agent");
    const human = wallet.account("human");

    expect(agent.address).toMatch(/^ecash:q/);
    expect(human.address).toMatch(/^ecash:q/);
    expect(agent.address).not.toBe(human.address);
    expect(agent.path).toBe("m/44'/1899'/0'/0/0");
    expect(agent.pubkey).toHaveLength(33);
  });

  test("is deterministic: the same phrase yields the same addresses", () => {
    for (const author of AUTHORS) {
      expect(Wallet.fromMnemonic(PHRASE).address(author)).toBe(
        Wallet.fromMnemonic(PHRASE).address(author),
      );
    }
  });

  test("a passphrase derives different keys from the same phrase", () => {
    const plain = Wallet.fromMnemonic(PHRASE).address("agent");
    const guarded = Wallet.fromMnemonic(PHRASE, { passphrase: "secret" }).address("agent");
    expect(guarded).not.toBe(plain);
  });

  test("a prefix override switches the address to testnet", () => {
    expect(Wallet.fromMnemonic(PHRASE, { prefix: "ectest" }).address("agent")).toMatch(
      /^ectest:/,
    );
  });
});

describe("signing keys", () => {
  test("expose a 32-byte secret key whose public key matches the account", () => {
    const wallet = Wallet.fromMnemonic(PHRASE);
    const key = wallet.signingKey("agent");
    expect(key.seckey).toHaveLength(32);
    expect(key.pubkey).toEqual(wallet.account("agent").pubkey);
    expect(new Ecc().derivePubkey(key.seckey)).toEqual(key.pubkey);
  });
});

describe("signer", () => {
  test("bundles the account's address with its signing key", () => {
    const wallet = Wallet.fromMnemonic(PHRASE);
    const signer = wallet.signer("human");
    expect(signer.address).toBe(wallet.account("human").address);
    expect(signer.seckey).toEqual(wallet.signingKey("human").seckey);
    expect(signer.pubkey).toEqual(wallet.account("human").pubkey);
  });
});

describe("generateMnemonic", () => {
  test("produces a valid 12-word BIP-39 phrase by default", () => {
    const phrase = generateMnemonic();
    const words = phrase.split(" ");
    expect(words).toHaveLength(12);
    expect(words.every((w) => wordlist.words.includes(w))).toBe(true);
    expect(mnemonicToEntropy(phrase, wordlist.words)).toHaveLength(16);
  });

  test("256 bits produces a 24-word phrase", () => {
    expect(generateMnemonic(256).split(" ")).toHaveLength(24);
  });

  test("two calls produce different phrases", () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic());
  });

  test("a generated phrase recovers a usable wallet", () => {
    const wallet = Wallet.fromMnemonic(generateMnemonic());
    expect(wallet.address("agent")).toMatch(/^ecash:q/);
  });

  test("rejects a non-standard entropy strength", () => {
    // @ts-expect-error 100 is not an allowed strength
    expect(() => generateMnemonic(100)).toThrow(InvalidEntropyError);
  });
});
