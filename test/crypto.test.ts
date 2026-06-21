import { beforeAll, describe, expect, test } from "bun:test";
import {
  DecryptError,
  ECIES_OVERHEAD_BYTES,
  type Signer,
  Wallet,
  decryptWithSeckey,
  encryptToPubkey,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let agent: Signer;
let human: Signer;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

beforeAll(() => {
  const wallet = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" });
  agent = wallet.signer("agent");
  human = wallet.signer("human");
});

describe("ECIES encrypt/decrypt (AMP-242)", () => {
  test("round-trips a message encrypted to a pubkey", () => {
    const blob = encryptToPubkey(enc("a private memory"), agent.pubkey);
    expect(dec(decryptWithSeckey(blob, agent.seckey))).toBe("a private memory");
  });

  test("works with the ecash-lib-derived agent and human keys independently", () => {
    const forHuman = encryptToPubkey(enc("for the human only"), human.pubkey);
    expect(dec(decryptWithSeckey(forHuman, human.seckey))).toBe("for the human only");
  });

  test("the wrong secret key cannot decrypt", () => {
    const blob = encryptToPubkey(enc("only the agent"), agent.pubkey);
    expect(() => decryptWithSeckey(blob, human.seckey)).toThrow(DecryptError);
  });

  test("a tampered ciphertext fails authentication", () => {
    const blob = encryptToPubkey(enc("integrity matters"), agent.pubkey);
    const last = blob.length - 1;
    blob[last] = (blob[last] ?? 0) ^ 0x01; // flip a bit in the auth tag
    expect(() => decryptWithSeckey(blob, agent.seckey)).toThrow(DecryptError);
  });

  test("encrypting the same plaintext twice yields different blobs (fresh ephemeral key)", () => {
    const a = encryptToPubkey(enc("same in"), agent.pubkey);
    const b = encryptToPubkey(enc("same in"), agent.pubkey);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(dec(decryptWithSeckey(a, agent.seckey))).toBe("same in");
    expect(dec(decryptWithSeckey(b, agent.seckey))).toBe("same in");
  });

  test("the blob carries the fixed ECIES overhead beyond the plaintext", () => {
    const blob = encryptToPubkey(enc("12345"), agent.pubkey);
    expect(blob.length).toBe(ECIES_OVERHEAD_BYTES + 5); // GCM ciphertext length == plaintext length
  });

  test("a blob shorter than the overhead is rejected", () => {
    expect(() => decryptWithSeckey(new Uint8Array(ECIES_OVERHEAD_BYTES - 1), agent.seckey)).toThrow(
      DecryptError,
    );
  });

  test("multibyte UTF-8 survives the round trip", () => {
    const blob = encryptToPubkey(enc("café · 日本語 · 🪙"), agent.pubkey);
    expect(dec(decryptWithSeckey(blob, agent.seckey))).toBe("café · 日本語 · 🪙");
  });
});
