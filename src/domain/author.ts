import type { MemoKind } from "./memo";

/**
 * The two authors of the shared memory. The agent writes churning working
 * memories; the human writes durable pins. Each signs with its own key, so the
 * signature on a coin is what authorizes the write — not the KIND byte, which is
 * only a self-description for readers.
 */
export type Author = "agent" | "human";

export const AUTHORS = ["agent", "human"] as const satisfies readonly Author[];

const KIND_BY_AUTHOR: Record<Author, MemoKind> = { agent: "memory", human: "pin" };

export const kindOf = (author: Author): MemoKind => KIND_BY_AUTHOR[author];

export const authorOf = (kind: MemoKind): Author => (kind === "memory" ? "agent" : "human");
