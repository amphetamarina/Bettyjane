import { MemoReader } from "../src/infrastructure/ecash/reader.js";
import { networkConfig, type Network } from "../src/infrastructure/ecash/network.js";
import { toMemoryView, type MemoryView } from "./view.js";

export interface AddressMemories {
  readonly address: string;
  readonly network: Network;
  readonly memories: MemoryView[];
}

/**
 * Read every live memo coin at an address and shape it for the page. Pointer
 * coins are resolved to their full text; a chunk that won't resolve falls back
 * to the raw pointer hex. This is the one read path shared by the local server
 * and the serverless API so both render identically. The reader is injectable
 * for tests; by default it talks to the network's Chronik endpoints.
 *
 * The imports are the narrow reader/network modules rather than the src/index
 * barrel on purpose: the serverless bundle then excludes the wallet, minter, and
 * keyring (and their key/wasm code), which keeps the read-only function small.
 *
 * Memories come back latest first: just-minted mempool coins lead, then
 * confirmed coins by descending block height, so the freshest memory is on top.
 */
export async function fetchAddressMemories(
  address: string,
  network: Network,
  reader: MemoReader = MemoReader.fromNetwork(networkConfig(network)),
): Promise<AddressMemories> {
  const coins = (await reader.listLiveCoins(address)).sort(
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
