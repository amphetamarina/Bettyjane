/**
 * Pure helpers for tidying the live memory: deciding which memory coins are
 * exact duplicates and may be forgotten. Kept free of I/O and chain code so the
 * consolidation rules are unit-testable; the consolidate hook reads the live
 * coins and feeds their ids and text here.
 */

export interface MemoryCoin {
  readonly id: string;
  readonly text: string;
}

/** Fold away cosmetic differences so duplicates compare equal: trim, lowercase, collapse whitespace runs. */
export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Plan which memory coins to forget so each distinct memory survives exactly
 * once. Coins are given oldest-first; within a group whose text matches after
 * {@link normalizeText}, the newest (last) coin is kept and the older ones are
 * returned as ids to forget, in their original order.
 */
export function planForget(memories: readonly MemoryCoin[]): string[] {
  const newest = new Map<string, string>();
  for (const coin of memories) {
    newest.set(normalizeText(coin.text), coin.id);
  }
  const keep = new Set(newest.values());
  return memories.filter((coin) => !keep.has(coin.id)).map((coin) => coin.id);
}
