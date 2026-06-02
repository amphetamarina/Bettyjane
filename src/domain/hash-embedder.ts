/**
 * A dependency-free embedder: a hashing bag-of-words. It needs no model, no API
 * key, and no network — it tokenizes text and hashes each token into a fixed
 * vector, so two notes that share words land near each other under cosine
 * similarity. It is a coarse stand-in for a real embedding model: good enough to
 * rank memories by lexical overlap, not for deep semantic similarity.
 */

import type { Embedder, Vector } from "./embedding-index";

const DEFAULT_DIMENSIONS = 256;

/** FNV-1a over the token's char codes, as an unsigned 32-bit integer. */
function hashToken(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Embed text as an L2-normalized hashing bag-of-words: lowercase, split on
 * non-alphanumerics, and add 1 to the dimension each token hashes to. Empty or
 * word-free text yields the zero vector (no direction), which cosine similarity
 * treats as similar to nothing.
 */
export function hashEmbed(value: string, dimensions: number = DEFAULT_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token) vector[hashToken(token) % dimensions]! += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

export class HashEmbedder implements Embedder {
  constructor(private readonly dimensions: number = DEFAULT_DIMENSIONS) {}

  embed(value: string): Promise<Vector> {
    return Promise.resolve(hashEmbed(value, this.dimensions));
  }
}
