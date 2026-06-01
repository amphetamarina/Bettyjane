import { describe, expect, test } from "bun:test";
import { normalizeText, planForget } from "../hooks/dedup";

describe("normalizeText", () => {
  test("trims surrounding whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  test("lowercases", () => {
    expect(normalizeText("Hello WORLD")).toBe("hello world");
  });

  test("collapses internal whitespace runs to single spaces", () => {
    expect(normalizeText("a\t b\n  c")).toBe("a b c");
  });
});

describe("planForget", () => {
  test("returns nothing for an empty live set", () => {
    expect(planForget([])).toEqual([]);
  });

  test("returns nothing when every memory is distinct", () => {
    const coins = [
      { id: "a:1", text: "first" },
      { id: "b:1", text: "second" },
    ];
    expect(planForget(coins)).toEqual([]);
  });

  test("forgets the older coin and keeps the newest of an exact duplicate", () => {
    const coins = [
      { id: "old:1", text: "are we funded?" },
      { id: "new:1", text: "are we funded?" },
    ];
    expect(planForget(coins)).toEqual(["old:1"]);
  });

  test("treats coins equal after normalization as duplicates", () => {
    const coins = [
      { id: "old:1", text: "  Are We Funded?  " },
      { id: "new:1", text: "are we funded?" },
    ];
    expect(planForget(coins)).toEqual(["old:1"]);
  });

  test("keeps only the newest across more than two duplicates", () => {
    const coins = [
      { id: "a:1", text: "ping" },
      { id: "b:1", text: "ping" },
      { id: "c:1", text: "ping" },
    ];
    expect(planForget(coins)).toEqual(["a:1", "b:1"]);
  });

  test("consolidates several duplicate groups independently", () => {
    const coins = [
      { id: "a:1", text: "alpha" },
      { id: "b:1", text: "beta" },
      { id: "c:1", text: "alpha" },
      { id: "d:1", text: "beta" },
      { id: "e:1", text: "gamma" },
    ];
    expect(planForget(coins)).toEqual(["a:1", "b:1"]);
  });
});
