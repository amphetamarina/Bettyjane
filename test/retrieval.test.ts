import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_WORKING,
  EmbeddingIndex,
  HashEmbedder,
  buildIndex,
  hashEmbed,
  retrieveRelevant,
} from "../src/index";

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

describe("buildIndex", () => {
  test("embeds each entry and keys it by coin id", async () => {
    const index = await buildIndex(
      [
        { id: "a:1", text: "the funding wallet ran out of coins" },
        { id: "b:1", text: "the explorer renders memories in the browser" },
      ],
      new HashEmbedder(),
    );

    expect(index.size).toBe(2);
    expect(index.ids().sort()).toEqual(["a:1", "b:1"]);
    const hits = index.nearest(hashEmbed("wallet funding coins"), 1);
    expect(hits[0]!.id).toBe("a:1");
  });

  test("returns an empty index for no entries", async () => {
    expect((await buildIndex([], new HashEmbedder())).size).toBe(0);
  });
});
