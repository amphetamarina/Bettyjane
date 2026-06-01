import { describe, expect, test } from "bun:test";
import { HashEmbedder, cosineSimilarity, hashEmbed } from "../src/index";

describe("hashEmbed", () => {
  test("is deterministic for the same text", () => {
    expect(hashEmbed("deploys run from CI")).toEqual(hashEmbed("deploys run from CI"));
  });

  test("ignores case and punctuation", () => {
    expect(hashEmbed("Hello, World!")).toEqual(hashEmbed("hello world"));
  });

  test("produces a unit vector for non-empty text", () => {
    const norm = Math.sqrt(hashEmbed("some words here").reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1);
  });

  test("produces the zero vector for word-free text", () => {
    expect(hashEmbed("   ...  ").every((x) => x === 0)).toBe(true);
  });

  test("ranks shared-word text as more similar than disjoint text", () => {
    const query = hashEmbed("the funding wallet ran out of coins");
    const near = hashEmbed("the wallet ran out of funding");
    const far = hashEmbed("explorer renders memories in the browser");
    expect(cosineSimilarity(query, near)).toBeGreaterThan(cosineSimilarity(query, far));
  });
});

describe("HashEmbedder", () => {
  test("embeds via hashEmbed", async () => {
    const embedder = new HashEmbedder();
    expect(await embedder.embed("a note")).toEqual(hashEmbed("a note"));
  });
});
