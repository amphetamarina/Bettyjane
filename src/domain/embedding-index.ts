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

/** A coin id and how similar its vector is to a query, in [-1, 1]. */
export interface ScoredCoin {
  readonly id: string;
  readonly score: number;
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

export class EmbeddingIndex {
  private readonly vectors = new Map<string, Vector>();

  get size(): number {
    return this.vectors.size;
  }

  has(coinId: string): boolean {
    return this.vectors.has(coinId);
  }

  ids(): string[] {
    return [...this.vectors.keys()];
  }

  get(coinId: string): Vector | undefined {
    const vector = this.vectors.get(coinId);
    return vector === undefined ? undefined : [...vector];
  }

  upsert(coinId: string, vector: Vector): void {
    this.vectors.set(coinId, [...vector]);
  }

  delete(coinId: string): boolean {
    return this.vectors.delete(coinId);
  }

  /**
   * The k coin ids whose vectors are most similar to `query`, most similar
   * first. Ties in score are broken by coin id so the order is deterministic.
   * Returns fewer than k when the index holds fewer coins, and nothing when k
   * is not positive.
   */
  nearest(query: Vector, k: number): ScoredCoin[] {
    if (k <= 0) return [];
    const scored: ScoredCoin[] = [];
    for (const [id, vector] of this.vectors) {
      scored.push({ id, score: cosineSimilarity(query, vector) });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return scored.slice(0, k);
  }

  toJSON(): Record<string, number[]> {
    const data: Record<string, number[]> = {};
    for (const [coinId, vector] of this.vectors) data[coinId] = [...vector];
    return data;
  }

  static fromJSON(data: Record<string, Vector>): EmbeddingIndex {
    const index = new EmbeddingIndex();
    for (const [coinId, vector] of Object.entries(data)) index.upsert(coinId, vector);
    return index;
  }
}
