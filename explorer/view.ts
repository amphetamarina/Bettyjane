import { authorOf, type Author, type LiveCoin, type MemoKind, type Network } from "../src/index";

export type MemoryContentView =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "pointer"; readonly pointerHex: string };

export interface MemoryView {
  readonly outpoint: string;
  readonly txid: string;
  readonly sats: string;
  readonly kind: MemoKind;
  readonly author: Author;
  readonly confirmed: boolean;
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

export function toMemoryView(coin: LiveCoin, network: Network): MemoryView {
  return {
    outpoint: `${coin.outpoint.txid}:${coin.outpoint.outIdx}`,
    txid: coin.outpoint.txid,
    sats: coin.sats.toString(),
    kind: coin.memo.kind,
    author: authorOf(coin.memo.kind),
    confirmed: coin.confirmed,
    content: contentView(coin),
    explorerUrl: txExplorerUrl(network, coin.outpoint.txid),
  };
}

function contentView(coin: LiveCoin): MemoryContentView {
  const content = coin.memo.content;
  if (content.type === "text") return { type: "text", text: content.text };
  return { type: "pointer", pointerHex: Buffer.from(content.pointer).toString("hex") };
}
