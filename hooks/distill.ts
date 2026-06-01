/**
 * Pure helpers for model-based capture: rendering the latest transcript turn as
 * text for a distiller, and reading the distiller's reply back into notes. Kept
 * free of I/O and chain code so the rules are unit-testable; the capture hook
 * and its worker do the file, subprocess, and chain work around them.
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

interface MemoryOpsEnvelope {
  readonly is_error?: boolean;
  readonly structured_output?: { readonly remember?: unknown };
}

/**
 * The notes to remember from a distiller's reply. The reply is the JSON
 * envelope `claude --output-format json` prints, carrying the schema-validated
 * memory-ops block in `structured_output`. Each note is trimmed and capped to
 * the on-chain byte budget; blank and non-string entries are dropped. Throws
 * when the reply is not the expected JSON, reports an error, or lacks a
 * remember array, so the caller can decline to write rather than mint garbage.
 */
export function parseMemoryOps(claudeStdout: string, maxBytes: number): string[] {
  let envelope: MemoryOpsEnvelope;
  try {
    envelope = JSON.parse(claudeStdout);
  } catch {
    throw new Error("distiller output was not JSON");
  }
  if (envelope.is_error) throw new Error("distiller reported an error");
  const remember = envelope.structured_output?.remember;
  if (!Array.isArray(remember)) throw new Error("distiller output missing structured_output.remember");
  const notes: string[] = [];
  for (const item of remember) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) notes.push(truncateToBytes(trimmed, maxBytes));
  }
  return notes;
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

