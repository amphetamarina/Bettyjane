import { describe, expect, test } from "bun:test";
import { truncateToBytes } from "../hooks/distill";

describe("truncateToBytes", () => {
  test("leaves a short ASCII string untouched", () => {
    expect(truncateToBytes("hello", 100)).toBe("hello");
  });

  test("cuts to at most the byte budget", () => {
    const out = truncateToBytes("abcdefghij", 4);
    expect(out).toBe("abcd");
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(4);
  });

  test("never splits a multi-byte codepoint", () => {
    // "é" is 2 bytes; a 3-byte budget must keep one whole "é", not half of the second.
    const out = truncateToBytes("éé", 3);
    expect(out).toBe("é");
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(3);
  });
});
