import { EmbeddingIndex, type Embedder, type Vector } from "./embedding-index";

export const DEFAULT_MAX_WORKING = 24;

export interface IndexEntry {
  readonly id: string;
  readonly text: string;
}

export async function buildIndex(
  entries: readonly IndexEntry[],
  embedder: Embedder,
): Promise<EmbeddingIndex> {
  const index = new EmbeddingIndex();
  for (const entry of entries) {
    index.upsert(entry.id, await embedder.embed(entry.text));
  }
  return index;
}

export interface RelevanceQuery {
  readonly index: EmbeddingIndex;
  readonly vector: Vector;
}

/**
 * At most `k` items, ranked by similarity to the query vector when one is given
 * (items absent from the index keep their order after the ranked ones), or the
 * first `k` as given when it is not.
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
