/**
 * Tidying the live memory: deciding which memories are near-duplicates and may
 * be dropped. Where exact-text dedup only catches identical notes, this groups
 * by embedding similarity, so "the wallet ran out of funds" and "we ran out of
 * funding" collapse to one. Pure: it compares vectors and returns ids to forget;
 * the SessionEnd hook embeds the live memories and does the spending.
 */

import { cosineSimilarity, type Vector } from "./embedding-index";

/** A memory's coin id and embedding, the input to consolidation. */
export interface VectoredMemory {
  readonly id: string;
  readonly vector: Vector;
}

/**
 * Plan which memories to forget so each cluster of near-duplicates survives once.
 * Memories are considered in the given order (pass newest-first to keep the
 * newest of each cluster): a memory whose similarity to an already-kept one is at
 * least `threshold` is dropped, otherwise it is kept as a new cluster
 * representative. Returns the dropped ids in input order.
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
