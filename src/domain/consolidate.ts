/**
 * Near-duplicate detection by embedding similarity, so "the wallet ran out of
 * funds" and "we ran out of funding" collapse to one.
 */

import { cosineSimilarity, type Vector } from "./embedding-index";

export interface VectoredMemory {
  readonly id: string;
  readonly vector: Vector;
}

/**
 * Forget every memory whose similarity to an already-kept one is at least
 * `threshold`. Memories are considered in input order, so pass them newest-first
 * to keep the newest of each cluster. Returns the dropped ids in input order.
 */
export function planConsolidation(
  memories: readonly VectoredMemory[],
  threshold: number,
): string[] {
  const kept: VectoredMemory[] = [];
  const drop: string[] = [];
  for (const memory of memories) {
    if (kept.some((k) => cosineSimilarity(k.vector, memory.vector) >= threshold)) {
      drop.push(memory.id);
    } else {
      kept.push(memory);
    }
  }
  return drop;
}
