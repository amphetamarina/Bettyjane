import { describe, expect, test } from "bun:test";
import { chunkText } from "../src/domain/chunking";

describe("chunkText", () => {
  test("returns a single chunk when the text fits the budget", () => {
    expect(chunkText("short", 100)).toEqual(["short"]);
  });

  test("splits into pieces no larger than the byte budget", () => {
    const chunks = chunkText("abcdefghij", 4);
    expect(chunks).toEqual(["abcd", "efgh", "ij"]);
    for (const chunk of chunks) expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(4);
  });

  test("concatenates back to the original text", () => {
    const text = "the quick brown fox ".repeat(20);
    expect(chunkText(text, 17).join("")).toBe(text);
  });

  test("never splits a multi-byte codepoint across chunks", () => {
    // Each "é" is 2 bytes; a 3-byte budget must keep each whole.
    const chunks = chunkText("ééé", 3);
    expect(chunks).toEqual(["é", "é", "é"]);
    expect(chunks.join("")).toBe("ééé");
  });

  test("handles an exact boundary without an empty trailing chunk", () => {
    expect(chunkText("abcdef", 3)).toEqual(["abc", "def"]);
  });

  test("returns an empty list for empty text", () => {
    expect(chunkText("", 10)).toEqual([]);
  });
});
