import { afterEach, describe, expect, test } from "bun:test";
import { parseNotes } from "../capture/turn";
import { distill } from "../capture/distiller";

describe("parseNotes (any-CLI distiller output)", () => {
  const cap = 1000;

  test("reads a JSON array of strings", () => {
    expect(parseNotes('["one", "two"]', cap)).toEqual(["one", "two"]);
  });

  test("reads a remember array on a JSON object", () => {
    expect(parseNotes('{"remember": ["a", "b"], "forgetIds": []}', cap)).toEqual(["a", "b"]);
  });

  test("unwraps a fenced code block", () => {
    expect(parseNotes('```json\n["x", "y"]\n```', cap)).toEqual(["x", "y"]);
  });

  test("tolerates leading prose before the JSON", () => {
    expect(parseNotes('Here are the notes:\n["k"]', cap)).toEqual(["k"]);
  });

  test("falls back to one note per line, stripping list markers", () => {
    expect(parseNotes("- first fact\n- second fact\n3. third fact", cap)).toEqual([
      "first fact",
      "second fact",
      "third fact",
    ]);
  });

  test("drops blanks and non-strings, and returns [] for empty output", () => {
    expect(parseNotes('["ok", "", 5, null]', cap)).toEqual(["ok"]);
    expect(parseNotes("   ", cap)).toEqual([]);
  });

  test("byte-caps a long note at a word boundary", () => {
    const note = parseNotes('["alpha beta gamma delta"]', 11)[0]!;
    expect(Buffer.byteLength(note)).toBeLessThanOrEqual(11);
    expect(note).toBe("alpha beta");
  });
});

describe("distill via BJ_DISTILL_CMD", () => {
  afterEach(() => {
    delete process.env.BJ_DISTILL_CMD;
  });

  test("runs the configured command and parses its stdout", async () => {
    process.env.BJ_DISTILL_CMD = "bun test/fixtures/echo-distiller.ts";
    const notes = await distill("User: hi\nAssistant: we shipped X", { maxBytes: 1000 });
    expect(notes).toEqual(["note from the configured command", "a second note"]);
  });

  test("throws when the configured command fails", async () => {
    process.env.BJ_DISTILL_CMD = "bun -e process.exit(3)";
    await expect(distill("turn", { maxBytes: 1000 })).rejects.toThrow();
  });
});
