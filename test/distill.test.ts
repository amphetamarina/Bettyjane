import { describe, expect, test } from "bun:test";
import { distillTurn, truncateToBytes } from "../hooks/distill";

const line = (obj: unknown) => JSON.stringify(obj);

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

describe("distillTurn", () => {
  test("returns the last user message text (string content)", () => {
    const lines = [
      line({ type: "user", message: { role: "user", content: "first ask" } }),
      line({ type: "assistant", message: { role: "assistant", content: "ok" } }),
      line({ type: "user", message: { role: "user", content: "wire the auth flow" } }),
    ];
    expect(distillTurn(lines, 200)).toBe("wire the auth flow");
  });

  test("extracts text from array content blocks", () => {
    const lines = [
      line({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "ship the release" }] },
      }),
    ];
    expect(distillTurn(lines, 200)).toBe("ship the release");
  });

  test("skips a user message that carries only a tool result", () => {
    const lines = [
      line({ type: "user", message: { role: "user", content: "real request" } }),
      line({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", content: "exit 0" }] },
      }),
    ];
    expect(distillTurn(lines, 200)).toBe("real request");
  });

  test("keeps only the first line", () => {
    const lines = [line({ type: "user", message: { role: "user", content: "title\nbody\nmore" } })];
    expect(distillTurn(lines, 200)).toBe("title");
  });

  test("truncates to the byte budget", () => {
    const lines = [line({ type: "user", message: { role: "user", content: "x".repeat(500) } })];
    const out = distillTurn(lines, 32);
    expect(out).not.toBeNull();
    expect(Buffer.byteLength(out!, "utf8")).toBeLessThanOrEqual(32);
  });

  test("returns null when there is no user text", () => {
    const lines = [line({ type: "assistant", message: { role: "assistant", content: "hi" } })];
    expect(distillTurn(lines, 200)).toBeNull();
  });

  test("ignores unparseable lines", () => {
    const lines = ["not json", line({ type: "user", message: { role: "user", content: "ok" } }), ""];
    expect(distillTurn(lines, 200)).toBe("ok");
  });
});
