import { ChronikClient } from "chronik-client";
import { Address, Script, fromHex, strToBytes, toHex } from "ecash-lib";
import type { MemoKind } from "../src/domain/memo";
import { authorOf, type Author } from "../src/domain/author";
import { decodeMemo, decodeMemoBatch } from "../src/infrastructure/ecash/memo-codec";
import { DUST_SATS } from "../src/infrastructure/ecash/protocol";
import { networkConfig, type Network } from "../src/infrastructure/ecash/network";
import { txExplorerUrl } from "./view";

/**
 * The chain-wide pool of memories under the `BJNE` LOKAD id, not just one
 * address. Chronik indexes transactions by LOKAD, so one query returns every
 * memo tx; each is decoded into the memory it minted and its author address.
 * Read-only and best-effort per tx.
 */

const BJNE_LOKAD = toHex(strToBytes("BJNE"));
const MAX_PAGES = 10;
const PAGE_SIZE = 200;
const MEMPOOL_BLOCK_HEIGHT = -1;

export type DiscoveredContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "pointer" }
  | { readonly type: "encrypted" };

export interface DiscoveredMemory {
  readonly address: string;
  readonly outpoint: string;
  readonly txid: string;
  readonly kind: MemoKind;
  readonly author: Author;
  readonly content: DiscoveredContent;
  readonly blockHeight: number;
  readonly confirmed: boolean;
  readonly spent: boolean;
  readonly explorerUrl: string | null;
}

export interface DiscoverResult {
  readonly network: Network;
  readonly memories: DiscoveredMemory[];
}

export interface DiscoverTx {
  readonly txid: string;
  readonly blockHeight: number;
  readonly outputs: readonly { readonly scriptHex: string; readonly sats: bigint; readonly spent: boolean }[];
}

/** Returns every transaction under a LOKAD id, newest first. */
export interface DiscoverSource {
  lokadTxs(lokadHex: string): Promise<readonly DiscoverTx[]>;
}

export async function fetchDiscover(
  network: Network,
  source: DiscoverSource = chronikDiscoverSource(network),
): Promise<DiscoverResult> {
  const prefix = networkConfig(network).prefix;
  const txs = await source.lokadTxs(BJNE_LOKAD);
  const memories: DiscoveredMemory[] = [];

  for (const tx of txs) {
    const opReturn = tx.outputs[0];
    if (!opReturn) continue;
    const script = new Script(fromHex(opReturn.scriptHex));
    const batch = safeBatch(script);
    const single = batch ? null : safeMemo(script);
    if (!batch && !single) continue;

    tx.outputs.forEach((output, outIdx) => {
      if (output.sats !== DUST_SATS) return; // only dust memo coins anchor a memory
      const memo = batch ? batch[outIdx - 1] : single;
      if (!memo) return;
      const address = addressOf(output.scriptHex, prefix);
      if (!address) return;
      memories.push({
        address,
        outpoint: `${tx.txid}:${outIdx}`,
        txid: tx.txid,
        kind: memo.kind,
        author: authorOf(memo.kind),
        content: contentOf(memo.content),
        blockHeight: tx.blockHeight,
        confirmed: tx.blockHeight !== MEMPOOL_BLOCK_HEIGHT,
        spent: output.spent,
        explorerUrl: txExplorerUrl(network, tx.txid),
      });
    });
  }
  return { network, memories };
}

export function chronikDiscoverSource(network: Network): DiscoverSource {
  const client = new ChronikClient([...networkConfig(network).chronikUrls]);
  return {
    lokadTxs: async (lokadHex) => {
      const txs: DiscoverTx[] = [];
      let page = 0;
      let numPages = 1;
      do {
        const result = await client.lokadId(lokadHex).history(page, PAGE_SIZE);
        numPages = result.numPages;
        for (const tx of result.txs) {
          txs.push({
            txid: tx.txid,
            blockHeight: tx.block?.height ?? MEMPOOL_BLOCK_HEIGHT,
            outputs: tx.outputs.map((output) => ({
              scriptHex: output.outputScript,
              sats: output.sats,
              spent: output.spentBy !== undefined,
            })),
          });
        }
        page += 1;
      } while (page < numPages && page < MAX_PAGES);
      return txs;
    },
  };
}

function safeMemo(script: Script): ReturnType<typeof decodeMemo> {
  try {
    return decodeMemo(script);
  } catch {
    return null;
  }
}

function safeBatch(script: Script): ReturnType<typeof decodeMemoBatch> {
  try {
    return decodeMemoBatch(script);
  } catch {
    return null;
  }
}

function addressOf(scriptHex: string, prefix: string): string | null {
  try {
    return Address.fromScriptHex(scriptHex, prefix).toString();
  } catch {
    return null;
  }
}

function contentOf(content: { type: string; text?: string }): DiscoveredContent {
  if (content.type === "text") return { type: "text", text: content.text ?? "" };
  if (content.type === "encrypted") return { type: "encrypted" };
  return { type: "pointer" };
}
