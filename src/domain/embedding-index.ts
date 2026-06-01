/**
 * The off-chain search index: a cache mapping each memory coin id to the
 * embedding vector of its text, queryable by similarity. It is a cache, not the
 * truth — the chain holds the memories, and the index can be rebuilt from them
 * whenever it is lost. This module is pure: it stores and compares vectors and
 * knows nothing about how they were produced or persisted.
 */

export type Vector = readonly number[];

/** Produces an embedding vector for a piece of text. Implemented off-chain. */
export interface Embedder {
  embed(text: string): Promise<Vector>;
}

/** Thrown when two vectors of different lengths are compared. */
export class DimensionMismatchError extends Error {
  constructor(
    readonly left: number,
    readonly right: number,
  ) {
    super(`cannot compare vectors of length ${left} and ${right}`);
    this.name = "DimensionMismatchError";
  }
}

/**
 * Cosine of the angle between two equal-length vectors: 1 for the same
 * direction, 0 for orthogonal, -1 for opposite. A zero-magnitude vector has no
 * direction, so its similarity to anything is 0 rather than undefined.
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length) throw new DimensionMismatchError(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
