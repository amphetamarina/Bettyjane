import { authorOf, type Author } from "../src/domain/author.js";
import type { MemoKind } from "../src/domain/memo.js";
import type { HistoricalCoin, LiveCoin } from "../src/infrastructure/ecash/reader.js";
import type { Network } from "../src/infrastructure/ecash/network.js";

export type MemoryContentView =
  | { readonly type: "text"; readonly text: string; readonly viaPointer: boolean }
  | { readonly type: "pointer"; readonly pointerHex: string }
  | { readonly type: "encrypted" };

export interface MemoryView {
  readonly outpoint: string;
  readonly txid: string;
  readonly sats: string;
  readonly kind: MemoKind;
  readonly author: Author;
  readonly confirmed: boolean;
  /** Whether the coin's memo carries a valid author signature (AMP-239). */
  readonly authorVerified: boolean;
  /** Whether the coin has been spent (the memory was forgotten); only set in the history view. */
  readonly spent: boolean;
  readonly content: MemoryContentView;
  readonly explorerUrl: string | null;
}

const TX_EXPLORERS: Record<Network, string | null> = {
  mainnet: "https://explorer.e.cash/tx/",
  testnet: "https://texplorer.e.cash/tx/",
  regtest: null,
};

export function txExplorerUrl(network: Network, txid: string): string | null {
  const base = TX_EXPLORERS[network];
  return base ? `${base}${txid}` : null;
}

/**
 * Build the view of a coin. For a pointer coin, pass `resolvedText` (the
 * reassembled chunks) so the reader sees the full memory as text; without it a
 * pointer falls back to its raw hex, which is what to show if resolution failed.
 */
export function toMemoryView(
  coin: LiveCoin | HistoricalCoin,
  network: Network,
  resolvedText?: string,
): MemoryView {
  return {
    outpoint: `${coin.outpoint.txid}:${coin.outpoint.outIdx}`,
    txid: coin.outpoint.txid,
    sats: coin.sats.toString(),
    kind: coin.memo.kind,
    author: authorOf(coin.memo.kind),
    confirmed: coin.confirmed,
    authorVerified: coin.authorVerified,
    spent: "spent" in coin ? coin.spent : false,
    content: contentView(coin, resolvedText),
    explorerUrl: txExplorerUrl(network, coin.outpoint.txid),
  };
}

function contentView(coin: LiveCoin, resolvedText?: string): MemoryContentView {
  const content = coin.memo.content;
  if (content.type === "text") return { type: "text", text: content.text, viaPointer: false };
  if (content.type === "encrypted") return { type: "encrypted" };
  if (resolvedText !== undefined) return { type: "text", text: resolvedText, viaPointer: true };
  return { type: "pointer", pointerHex: Buffer.from(content.pointer).toString("hex") };
}
