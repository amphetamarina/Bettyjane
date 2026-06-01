/**
 * Choosing the working set: the small slice of memory the brain sees each turn.
 * The live set is already curated by forgetting, but it is still not all poured
 * into the prompt — retrieveRelevant picks at most MAX_WORKING of it, ranked by
 * similarity to a query when one is given, or in order otherwise. Pure: callers
 * supply the items and, for ranking, an index.
 */

import { EmbeddingIndex, type Vector } from "./embedding-index";

/** Default working-set size: a couple dozen, the knob the spec leaves to the model. */
export const DEFAULT_MAX_WORKING = 24;

/** A query to rank by: an embedding vector and the index to score against. */
export interface RelevanceQuery {
  readonly index: EmbeddingIndex;
  readonly vector: Vector;
}

/**
 * The working set: at most `k` items. With a query, items are ranked by the
 * index's similarity to the query vector, most relevant first; items absent from
 * the index keep their original order after the ranked ones. Without a query,
 * the first `k` items are returned as given.
 */
export function retrieveRelevant<T extends { readonly id: string }>(
  items: readonly T[],
  k: number,
  query?: RelevanceQuery,
): T[] {
  if (k <= 0) return [];
  if (!query) return items.slice(0, k);

  const rankById = new Map<string, number>();
  query.index.nearest(query.vector, query.index.size).forEach((hit, i) => rankById.set(hit.id, i));

  const ranked = [...items].sort((a, b) => {
    const ra = rankById.get(a.id) ?? Number.POSITIVE_INFINITY;
    const rb = rankById.get(b.id) ?? Number.POSITIVE_INFINITY;
    return ra === rb ? 0 : ra < rb ? -1 : 1;
  });
  return ranked.slice(0, k);
}
