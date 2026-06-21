/**
 * Split `value` into contiguous pieces, each at most `maxBytes` UTF-8 bytes,
 * that concatenate back to the original. A codepoint is never split across
 * pieces; the only way a piece exceeds the budget is a single codepoint larger
 * than it, which cannot be divided.
 */
export function chunkText(value: string, maxBytes: number): string[] {
  if (maxBytes <= 0) throw new RangeError("maxBytes must be positive");
  const chunks: string[] = [];
  let current = "";
  for (const ch of value) {
    if (current !== "" && Buffer.byteLength(current + ch, "utf8") > maxBytes) {
      chunks.push(current);
      current = "";
    }
    current += ch;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}
