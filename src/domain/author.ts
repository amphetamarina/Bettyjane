import type { MemoKind } from "./memo";

/**
 * The two authors of the shared memory. A coin's signature, not its KIND byte,
 * authorizes the write: the KIND is only a self-description for readers.
 */
export type Author = "agent" | "human";

export const AUTHORS = ["agent", "human"] as const satisfies readonly Author[];

const KIND_BY_AUTHOR: Record<Author, MemoKind> = { agent: "memory", human: "pin" };

export const kindOf = (author: Author): MemoKind => KIND_BY_AUTHOR[author];

/**
 * The author side a kind surfaces under: pins are the human's, everything else
 * the agent's. Consensus memos are co-authored, so they surface under the agent
 * side and are distinguished by their kind, not their author.
 */
export const authorOf = (kind: MemoKind): Author => (kind === "pin" ? "human" : "agent");
