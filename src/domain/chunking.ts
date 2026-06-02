/**
 * Splitting long memory text across coins. One OP_RETURN holds only a bounded
 * number of bytes, so text that does not fit inline is stored as an ordered set
 * of chunk transactions and reassembled by concatenation. This is the pure
 * split rule; the minter writes the chunks and the reader rejoins them.
 */

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
