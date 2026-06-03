import { beforeAll, describe, expect, test } from "bun:test";
import { Address, Ecc } from "ecash-lib";
import {
  MAX_SIGNED_PAYLOAD_BYTES,
  MalformedMemoError,
  MemoTooLargeError,
  SIGNATURE_BYTES,
  SIGNED_PROTOCOL_VERSION,
  type Signer,
  Wallet,
  decodeMemo,
  decodeSignedMemo,
  encodeMemo,
  encodeSignedMemo,
  memory,
  pin,
  pointer,
  signingDigest,
  text,
  verifyMemoAuthor,
} from "../src/index";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let ecc: Ecc;
let signer: Signer;
let ownerScript: Uint8Array;
let otherOwnerScript: Uint8Array;

beforeAll(() => {
  // ecash-lib's wasm is not ready at module-eval time; build keys here.
  const wallet = Wallet.fromMnemonic(PHRASE, { prefix: "ectest" });
  signer = wallet.signer("human");
  ownerScript = Address.fromCashAddress(signer.address).toScript().bytecode;
  otherOwnerScript = Address.fromCashAddress(wallet.signer("agent").address).toScript().bytecode;
  ecc = new Ecc();
});

function sign(memo: Parameters<typeof signingDigest>[0]) {
  return encodeSignedMemo(memo, ecc.signRecoverable(signer.seckey, signingDigest(memo)));
}

describe("signed memo encode/decode", () => {
  test("a signed memo decodes to the same content as an unsigned one", () => {
    const memo = memory(text("eCash upgrade date is 2025-11-15"));
    expect(decodeMemo(sign(memo))).toEqual(memo);
  });

  test("decodeSignedMemo exposes a 65-byte signature for a v2 memo", () => {
    const memo = pin(text("standing: cite dates"));
    const decoded = decodeSignedMemo(sign(memo));
    expect(decoded?.memo).toEqual(memo);
    expect(decoded?.signature).toHaveLength(SIGNATURE_BYTES);
    expect(decoded?.digest).toHaveLength(32);
  });

  test("an unsigned v1 memo decodes with a null signature", () => {
    const decoded = decodeSignedMemo(encodeMemo(memory(text("plain"))));
    expect(decoded?.signature).toBeNull();
  });

  test("the signed memo header carries version 2", () => {
    const hex = sign(memory(text("x"))).toHex();
    // OP_RETURN(6a) 04 'BJNE' | 03 <version=02, kind=memory=01, ct=text=00>
    expect(hex.slice(0, 12)).toBe("6a04424a4e45");
    expect(hex.slice(12, 20)).toBe("03020100");
    expect(SIGNED_PROTOCOL_VERSION).toBe(2);
  });

  test("signingDigest is deterministic", () => {
    const memo = memory(text("same in, same out"));
    expect(signingDigest(memo)).toEqual(signingDigest(memo));
  });
});

describe("verifyMemoAuthor", () => {
  test("verifies a memo signed by the coin's own key", () => {
    expect(verifyMemoAuthor(sign(memory(text("recall this"))), ownerScript, ecc)).toBe(true);
  });

  test("rejects a memo whose content was altered after signing (tamper)", () => {
    const original = memory(text("the original note"));
    const signature = ecc.signRecoverable(signer.seckey, signingDigest(original));
    // Reuse the signature on different content: the recovered key won't match.
    const tampered = encodeSignedMemo(memory(text("a different note!")), signature);
    expect(verifyMemoAuthor(tampered, ownerScript, ecc)).toBe(false);
  });

  test("rejects a valid signature checked against a different owner address", () => {
    expect(verifyMemoAuthor(sign(memory(text("mine"))), otherOwnerScript, ecc)).toBe(false);
  });

  test("rejects an unsigned v1 memo", () => {
    expect(verifyMemoAuthor(encodeMemo(memory(text("unsigned"))), ownerScript, ecc)).toBe(false);
  });
});

describe("signed memo limits", () => {
  test("rejects an inline payload over the signed budget", () => {
    const tooBig = memory(text("a".repeat(MAX_SIGNED_PAYLOAD_BYTES + 1)));
    const sig = new Uint8Array(SIGNATURE_BYTES);
    expect(() => encodeSignedMemo(tooBig, sig)).toThrow(MemoTooLargeError);
  });

  test("rejects a signature of the wrong length", () => {
    expect(() => encodeSignedMemo(memory(text("x")), new Uint8Array(10))).toThrow(MalformedMemoError);
  });

  test("a payload at the signed limit still fits the standardness budget", () => {
    const memo = memory(text("a".repeat(MAX_SIGNED_PAYLOAD_BYTES)));
    expect(sign(memo).bytecode.length).toBeLessThanOrEqual(223);
  });

  test("a pointer memo can also be signed", () => {
    const memo = memory(pointer(Uint8Array.from({ length: 32 }, (_, i) => i)));
    expect(verifyMemoAuthor(sign(memo), ownerScript, ecc)).toBe(true);
  });
});
