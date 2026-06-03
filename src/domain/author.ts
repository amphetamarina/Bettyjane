import type { MemoKind } from "./memo.js";

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

/**
 * The author side that surfaces a kind. A pin is the human's; a memory is the
 * agent's. A consensus memo is co-authored at a 2-of-2 address — it has no single
 * author, so it surfaces under the agent side here; the CONSENSUS kind is what
 * actually distinguishes it (readers and the explorer label it by kind).
 */
export const authorOf = (kind: MemoKind): Author => (kind === "pin" ? "human" : "agent");
