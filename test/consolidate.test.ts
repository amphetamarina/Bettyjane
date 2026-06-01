import { describe, expect, test } from "bun:test";
import { hashEmbed, planConsolidation } from "../src/index";

const mem = (id: string, text: string) => ({ id, vector: hashEmbed(text) });

describe("planConsolidation", () => {
  test("keeps distinct memories", () => {
    const memories = [
      mem("a:1", "the funding wallet ran out of coins"),
      mem("b:1", "the explorer renders memories in the browser"),
    ];
    expect(planConsolidation(memories, 0.9)).toEqual([]);
  });

  test("drops an exact duplicate, keeping the first seen", () => {
    const memories = [mem("new:1", "are we funded?"), mem("old:1", "are we funded?")];
    expect(planConsolidation(memories, 0.9)).toEqual(["old:1"]);
  });

  test("collapses case- and punctuation-only differences", () => {
    const memories = [mem("a:1", "Are We Funded?"), mem("b:1", "are we funded")];
    expect(planConsolidation(memories, 0.9)).toEqual(["b:1"]);
  });

  test("drops a near-duplicate that shares most words", () => {
    const memories = [
      mem("a:1", "the agent wallet ran out of funding coins"),
      mem("b:1", "the agent wallet ran out of funding"),
    ];
    expect(planConsolidation(memories, 0.85)).toEqual(["b:1"]);
  });

  test("keeps memories below the similarity threshold", () => {
    const memories = [
      mem("a:1", "deploys run from continuous integration only"),
      mem("b:1", "the explorer is a browser page"),
    ];
    expect(planConsolidation(memories, 0.9)).toEqual([]);
  });
});
