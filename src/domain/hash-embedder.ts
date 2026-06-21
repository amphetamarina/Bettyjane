/**
 * A dependency-free hashing bag-of-words embedder: no model, key, or network.
 * A coarse stand-in that ranks by lexical overlap, not deep semantic similarity.
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
 * Lowercase, split on non-alphanumerics, hash each token to a dimension, then
 * L2-normalize. Word-free text yields the zero vector.
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
