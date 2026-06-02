import { describe, expect, test } from "bun:test";
import { parseMemoryOps } from "../hooks/distill";

const envelope = (structured_output: unknown, extra: object = {}) =>
  JSON.stringify({ type: "result", is_error: false, result: "ok", structured_output, ...extra });

describe("parseMemoryOps", () => {
  test("extracts the remember notes from a valid envelope", () => {
    const out = parseMemoryOps(envelope({ remember: ["note a", "note b"], forgetIds: [] }), 200);
    expect(out).toEqual(["note a", "note b"]);
  });

  test("returns an empty list when there is nothing to remember", () => {
    expect(parseMemoryOps(envelope({ remember: [], forgetIds: [] }), 200)).toEqual([]);
  });

  test("trims notes and drops blank or non-string entries", () => {
    const out = parseMemoryOps(envelope({ remember: ["  kept  ", "", "   ", 42, null], forgetIds: [] }), 200);
    expect(out).toEqual(["kept"]);
  });

  test("truncates each note to the byte budget", () => {
    const out = parseMemoryOps(envelope({ remember: ["x".repeat(500)], forgetIds: [] }), 16);
    expect(Buffer.byteLength(out[0]!, "utf8")).toBeLessThanOrEqual(16);
  });

  test("truncates at a word boundary rather than mid-word", () => {
    const out = parseMemoryOps(envelope({ remember: ["alpha beta gamma delta"], forgetIds: [] }), 14);
    expect(out).toEqual(["alpha beta"]);
  });

  test("throws on output that is not JSON", () => {
    expect(() => parseMemoryOps("not json", 200)).toThrow();
  });

  test("throws when the envelope has no structured_output", () => {
    expect(() => parseMemoryOps(JSON.stringify({ type: "result", result: "ok" }), 200)).toThrow();
  });

  test("throws when remember is not an array", () => {
    expect(() => parseMemoryOps(envelope({ remember: "nope", forgetIds: [] }), 200)).toThrow();
  });

  test("throws when the envelope reports an error", () => {
    expect(() => parseMemoryOps(envelope({ remember: [] }, { is_error: true }), 200)).toThrow();
  });
});
