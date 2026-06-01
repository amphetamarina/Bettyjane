import { describe, expect, test } from "bun:test";
import { OP_RETURN, Script, pushBytesOp, strToBytes } from "ecash-lib";
import {
  DUST_SATS,
  EmptyMemoError,
  MAX_PAYLOAD_BYTES,
  MalformedMemoError,
  MemoTooLargeError,
  PROTOCOL_VERSION,
  UnsupportedVersionError,
  decodeMemo,
  encodeMemo,
  isMemoScript,
  memory,
  pin,
  pointer,
  text,
} from "../src/index";

describe("encode/decode round-trips", () => {
  test("an agent memory note", () => {
    const memo = memory(text("eCash upgrade date is 2025-11-15"));
    expect(decodeMemo(encodeMemo(memo))).toEqual(memo);
  });

  test("a human pin", () => {
    const memo = pin(text("Always cite the eCash upgrade date as 2025-11-15."));
    expect(decodeMemo(encodeMemo(memo))).toEqual(memo);
  });

  test("a pointer payload", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i);
    const memo = memory(pointer(bytes));
    expect(decodeMemo(encodeMemo(memo))).toEqual(memo);
  });

  test("multibyte UTF-8 text", () => {
    const memo = memory(text("café — naïve — 日本語 — 🪙"));
    expect(decodeMemo(encodeMemo(memo))).toEqual(memo);
  });
});

describe("wire format", () => {
  test("a memory coin holds one dust output", () => {
    expect(DUST_SATS).toBe(546n);
  });

  test("the script starts with OP_RETURN and the BJNE prefix", () => {
    const hex = encodeMemo(memory(text("x"))).toHex();
    expect(hex.startsWith("6a04424a4e45")).toBe(true);
  });

  test("text at the limit encodes within the standardness budget", () => {
    const memo = memory(text("a".repeat(MAX_PAYLOAD_BYTES)));
    const script = encodeMemo(memo);
    expect(script.bytecode.length).toBeLessThanOrEqual(223);
    expect(decodeMemo(script)).toEqual(memo);
  });
});

describe("invariants", () => {
  test("rejects empty text at construction", () => {
    expect(() => text("")).toThrow(EmptyMemoError);
  });

  test("rejects empty pointer at construction", () => {
    expect(() => pointer(new Uint8Array())).toThrow(EmptyMemoError);
  });

  test("rejects text one byte over the limit", () => {
    const memo = memory(text("a".repeat(MAX_PAYLOAD_BYTES + 1)));
    expect(() => encodeMemo(memo)).toThrow(MemoTooLargeError);
  });
});

describe("decoding foreign and malformed scripts", () => {
  test("a non-OP_RETURN script is not ours", () => {
    const script = Script.fromOps([pushBytesOp(strToBytes("hello"))]);
    expect(decodeMemo(script)).toBeNull();
    expect(isMemoScript(script)).toBe(false);
  });

  test("a foreign OP_RETURN protocol is not ours", () => {
    const script = Script.fromOps([
      OP_RETURN,
      pushBytesOp(Uint8Array.of(0x53, 0x4c, 0x50, 0x00)), // SLP
      pushBytesOp(strToBytes("whatever")),
    ]);
    expect(decodeMemo(script)).toBeNull();
    expect(isMemoScript(script)).toBe(false);
  });

  test("our prefix with an unsupported version throws", () => {
    const script = Script.fromOps([
      OP_RETURN,
      pushBytesOp(strToBytes("BJNE")),
      pushBytesOp(Uint8Array.of(0x7f, 0x01, 0x00)),
      pushBytesOp(strToBytes("x")),
    ]);
    expect(() => decodeMemo(script)).toThrow(UnsupportedVersionError);
    expect(isMemoScript(script)).toBe(true);
  });

  test("our prefix with an unknown kind throws", () => {
    const script = Script.fromOps([
      OP_RETURN,
      pushBytesOp(strToBytes("BJNE")),
      pushBytesOp(Uint8Array.of(PROTOCOL_VERSION, 0x55, 0x00)),
      pushBytesOp(strToBytes("x")),
    ]);
    expect(() => decodeMemo(script)).toThrow(MalformedMemoError);
  });

  test("our prefix with a missing payload throws", () => {
    const script = Script.fromOps([
      OP_RETURN,
      pushBytesOp(strToBytes("BJNE")),
      pushBytesOp(Uint8Array.of(PROTOCOL_VERSION, 0x01, 0x00)),
    ]);
    expect(() => decodeMemo(script)).toThrow(MalformedMemoError);
  });
});
