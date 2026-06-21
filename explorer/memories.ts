import { MemoReader } from "../src/infrastructure/ecash/reader.js";
import { networkConfig, type Network } from "../src/infrastructure/ecash/network.js";
import { toMemoryView, type MemoryView } from "./view.js";

export interface AddressMemories {
  readonly address: string;
  readonly network: Network;
  readonly memories: MemoryView[];
}

/**
 * Read the memo coins at an address and shape them for the page, latest first
 * (mempool coins, then confirmed by descending block height). Pointer coins are
 * resolved to full text, falling back to the raw pointer hex on failure. With
 * `includeSpent`, returns every memory ever minted, each flagged `spent` if
 * since forgotten (reconstructed from transaction history).
 *
 * Imports the narrow reader/network modules rather than the src/index barrel on
 * purpose: the serverless bundle then excludes the wallet, minter, and keyring
 * (and their key/wasm code), keeping the read-only function small.
 */
export async function fetchAddressMemories(
  address: string,
  network: Network,
  reader: MemoReader = MemoReader.fromNetwork(networkConfig(network)),
  includeSpent = false,
): Promise<AddressMemories> {
  const coins = (includeSpent ? await reader.listAllCoins(address) : await reader.listLiveCoins(address)).sort(
    (a, b) => recency(b.blockHeight) - recency(a.blockHeight),
  );
  const memories = await Promise.all(
    coins.map(async (coin) => {
      if (coin.memo.content.type !== "pointer") return toMemoryView(coin, network);
      try {
        return toMemoryView(coin, network, await reader.resolveText(coin));
      } catch {
        return toMemoryView(coin, network);
      }
    }),
  );
  return { address, network, memories };
}

const MEMPOOL_BLOCK_HEIGHT = -1;

function recency(blockHeight: number): number {
  return blockHeight === MEMPOOL_BLOCK_HEIGHT ? Infinity : blockHeight;
}
