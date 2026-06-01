import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_WORKING, EmbeddingIndex, retrieveRelevant } from "../src/index";

const item = (id: string) => ({ id });

describe("retrieveRelevant", () => {
  test("returns the first k items when there is no query", () => {
    const items = [item("a"), item("b"), item("c")];
    expect(retrieveRelevant(items, 2)).toEqual([item("a"), item("b")]);
  });

  test("returns nothing for a non-positive k", () => {
    expect(retrieveRelevant([item("a")], 0)).toEqual([]);
  });

  test("returns every item when k exceeds the count", () => {
    const items = [item("a"), item("b")];
    expect(retrieveRelevant(items, 99)).toHaveLength(2);
  });

  test("ranks by similarity to the query, most relevant first", () => {
    const index = new EmbeddingIndex();
    index.upsert("east", [1, 0]);
    index.upsert("north", [0, 1]);
    const items = [item("north"), item("east")];

    const hits = retrieveRelevant(items, 2, { index, vector: [1, 0] });

    expect(hits.map((h) => h.id)).toEqual(["east", "north"]);
  });

  test("places items missing from the index after the ranked ones", () => {
    const index = new EmbeddingIndex();
    index.upsert("east", [1, 0]);
    const items = [item("unindexed"), item("east")];

    const hits = retrieveRelevant(items, 2, { index, vector: [1, 0] });

    expect(hits.map((h) => h.id)).toEqual(["east", "unindexed"]);
  });

  test("exposes a sane default working-set size", () => {
    expect(DEFAULT_MAX_WORKING).toBeGreaterThan(0);
  });
});
