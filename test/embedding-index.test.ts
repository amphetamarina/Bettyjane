import { describe, expect, test } from "bun:test";
import { DimensionMismatchError, EmbeddingIndex, cosineSimilarity } from "../src/domain/embedding-index";

describe("cosineSimilarity", () => {
  test("is 1 for identical direction", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  test("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  test("is -1 for opposite direction", () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });

  test("is 0 when either vector has zero magnitude", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  test("throws when dimensions differ", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(DimensionMismatchError);
  });
});

describe("EmbeddingIndex store", () => {
  test("starts empty", () => {
    const index = new EmbeddingIndex();
    expect(index.size).toBe(0);
    expect(index.ids()).toEqual([]);
    expect(index.has("a:1")).toBe(false);
  });

  test("upserts a vector under a coin id", () => {
    const index = new EmbeddingIndex();
    index.upsert("a:1", [1, 0]);
    expect(index.size).toBe(1);
    expect(index.has("a:1")).toBe(true);
    expect(index.ids()).toEqual(["a:1"]);
  });

  test("upsert overwrites the vector for an existing coin id", () => {
    const index = new EmbeddingIndex();
    index.upsert("a:1", [1, 0]);
    index.upsert("a:1", [0, 1]);
    expect(index.size).toBe(1);
    expect(index.get("a:1")).toEqual([0, 1]);
  });

  test("stores a copy so mutating the caller's vector does not change the index", () => {
    const index = new EmbeddingIndex();
    const vector = [1, 0];
    index.upsert("a:1", vector);
    vector[0] = 99;
    expect(index.get("a:1")).toEqual([1, 0]);
  });

  test("delete removes a coin id and reports whether it was present", () => {
    const index = new EmbeddingIndex();
    index.upsert("a:1", [1, 0]);
    expect(index.delete("a:1")).toBe(true);
    expect(index.delete("a:1")).toBe(false);
    expect(index.has("a:1")).toBe(false);
    expect(index.size).toBe(0);
  });

  test("round-trips through JSON", () => {
    const index = new EmbeddingIndex();
    index.upsert("a:1", [1, 0]);
    index.upsert("b:1", [0, 1]);
    const restored = EmbeddingIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())));
    expect(restored.ids().sort()).toEqual(["a:1", "b:1"]);
    expect(restored.get("a:1")).toEqual([1, 0]);
    expect(restored.get("b:1")).toEqual([0, 1]);
  });
});

describe("EmbeddingIndex.nearest", () => {
  const index = () => {
    const idx = new EmbeddingIndex();
    idx.upsert("east:1", [1, 0]);
    idx.upsert("north:1", [0, 1]);
    idx.upsert("northeast:1", [1, 1]);
    return idx;
  };

  test("returns an empty list for an empty index", () => {
    expect(new EmbeddingIndex().nearest([1, 0], 3)).toEqual([]);
  });

  test("returns nothing when k is zero or negative", () => {
    expect(index().nearest([1, 0], 0)).toEqual([]);
    expect(index().nearest([1, 0], -1)).toEqual([]);
  });

  test("ranks coins by descending cosine similarity to the query", () => {
    const hits = index().nearest([1, 0], 3);
    expect(hits.map((h) => h.id)).toEqual(["east:1", "northeast:1", "north:1"]);
    expect(hits[0]!.score).toBeCloseTo(1);
    expect(hits[2]!.score).toBeCloseTo(0);
  });

  test("returns at most k hits", () => {
    expect(index().nearest([1, 0], 2).map((h) => h.id)).toEqual(["east:1", "northeast:1"]);
  });

  test("returns every coin when k exceeds the index size", () => {
    expect(index().nearest([1, 0], 99)).toHaveLength(3);
  });

  test("breaks ties by coin id for a deterministic order", () => {
    const idx = new EmbeddingIndex();
    idx.upsert("b:1", [1, 0]);
    idx.upsert("a:1", [1, 0]);
    expect(idx.nearest([1, 0], 2).map((h) => h.id)).toEqual(["a:1", "b:1"]);
  });
});
