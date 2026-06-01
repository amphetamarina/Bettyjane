import { describe, expect, test } from "bun:test";
import {
  ENV_MNEMONIC,
  ENV_NETWORK,
  ENV_PASSPHRASE,
  InvalidNetworkError,
  MissingMnemonicError,
  Wallet,
  loadWallet,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("loadWallet from the environment", () => {
  test("derives the same wallet the mnemonic would", () => {
    const wallet = loadWallet({ [ENV_MNEMONIC]: PHRASE });
    const expected = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" });
    expect(wallet.address("human")).toBe(expected.address("human"));
    expect(wallet.address("agent")).toBe(expected.address("agent"));
  });

  test("defaults to testnet so a bootstrap never touches real XEC", () => {
    const wallet = loadWallet({ [ENV_MNEMONIC]: PHRASE });
    expect(wallet.address("human")).toMatch(/^ectest:/);
  });

  test("honours BJ_NETWORK=mainnet", () => {
    const wallet = loadWallet({ [ENV_MNEMONIC]: PHRASE, [ENV_NETWORK]: "mainnet" });
    expect(wallet.address("human")).toMatch(/^ecash:/);
  });

  test("trims surrounding whitespace from the phrase", () => {
    const wallet = loadWallet({ [ENV_MNEMONIC]: `\n  ${PHRASE}  \n` });
    const expected = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" });
    expect(wallet.address("human")).toBe(expected.address("human"));
  });

  test("applies BJ_PASSPHRASE so a different passphrase derives different keys", () => {
    const plain = loadWallet({ [ENV_MNEMONIC]: PHRASE });
    const guarded = loadWallet({ [ENV_MNEMONIC]: PHRASE, [ENV_PASSPHRASE]: "secret" });
    expect(guarded.address("human")).not.toBe(plain.address("human"));
  });

  test("throws MissingMnemonicError when BJ_MNEMONIC is unset", () => {
    expect(() => loadWallet({})).toThrow(MissingMnemonicError);
  });

  test("throws MissingMnemonicError when BJ_MNEMONIC is blank", () => {
    expect(() => loadWallet({ [ENV_MNEMONIC]: "   " })).toThrow(MissingMnemonicError);
  });

  test("rejects an unknown BJ_NETWORK", () => {
    expect(() => loadWallet({ [ENV_MNEMONIC]: PHRASE, [ENV_NETWORK]: "mainnett" })).toThrow(
      InvalidNetworkError,
    );
  });

  test("accepts regtest as a valid BJ_NETWORK", () => {
    expect(() => loadWallet({ [ENV_MNEMONIC]: PHRASE, [ENV_NETWORK]: "regtest" })).not.toThrow();
  });

  test("reads process.env by default", () => {
    const prior = process.env[ENV_MNEMONIC];
    process.env[ENV_MNEMONIC] = PHRASE;
    try {
      expect(loadWallet().address("human")).toMatch(/^ectest:/);
    } finally {
      if (prior === undefined) delete process.env[ENV_MNEMONIC];
      else process.env[ENV_MNEMONIC] = prior;
    }
  });
});
