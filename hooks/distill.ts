/**
 * Pure helpers for turning a Claude Code transcript into a one-line memory.
 * Kept free of I/O and chain code so the distillation rules are unit-testable;
 * the capture hook reads the transcript file and feeds its lines here.
 */

interface ContentBlock {
  readonly type?: string;
  readonly text?: string;
}

type Content = string | readonly ContentBlock[] | undefined;

interface TranscriptEntry {
  readonly role?: string;
  readonly content?: Content;
  readonly isMeta?: boolean;
  readonly message?: { readonly role?: string; readonly content?: Content };
}

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a codepoint. */
export function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let out = "";
  for (const ch of value) {
    if (Buffer.byteLength(out + ch, "utf8") > maxBytes) break;
    out += ch;
  }
  return out;
}

function extractText(content: Content): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is ContentBlock => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

interface RenderedEntry {
  readonly role: "user" | "assistant";
  readonly text: string;
}

function entriesOf(lines: readonly string[]): RenderedEntry[] {
  const entries: RenderedEntry[] = [];
  for (const raw of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (entry.isMeta) continue;
    const role = entry.message?.role ?? entry.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = extractText(entry.message?.content ?? entry.content).trim();
    if (text) entries.push({ role, text });
  }
  return entries;
}

/**
 * The latest turn as text for a distiller: the last thing the human asked plus
 * the assistant's response to it, formatted as labelled blocks. Earlier
 * exchanges, isMeta injections, and entries that carry no text (tool calls and
 * tool results) are dropped, so the turn is just what was said this round.
 * Truncated to `maxBytes` from the head, which keeps the user's ask. Returns an
 * empty string when the turn holds no human ask.
 */
export function renderTurn(lines: readonly string[], maxBytes: number): string {
  const entries = entriesOf(lines);
  let lastUser = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.role === "user") lastUser = i;
  }
  if (lastUser === -1) return "";
  const turn = entries
    .slice(lastUser)
    .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.text}`)
    .join("\n\n");
  return truncateToBytes(turn, maxBytes);
}

/**
 * The team's working memory of a turn: the last thing the human actually asked,
 * as a single trimmed line within the on-chain byte budget. Assistant messages
 * and tool-result user messages carry no human ask and are skipped, as are
 * isMeta entries — skill banners and harness-injected notes that wear the user
 * role without the human having typed them. Returns null when the turn holds
 * nothing worth remembering.
 */
export function distillTurn(lines: readonly string[], maxBytes: number): string | null {
  let memory: string | null = null;
  for (const raw of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (entry.isMeta) continue;
    if ((entry.message?.role ?? entry.role) !== "user") continue;
    const text = extractText(entry.message?.content ?? entry.content).trim();
    const firstLine = (text.split("\n")[0] ?? "").trim();
    if (firstLine) memory = firstLine;
  }
  return memory === null ? null : truncateToBytes(memory, maxBytes);
}
