import { MemoReader, networkConfig, type Network } from "../src/index";
import { toMemoryView, type MemoryView } from "./view";

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
 */
export async function fetchAddressMemories(
  address: string,
  network: Network,
  reader: MemoReader = MemoReader.fromNetwork(networkConfig(network)),
): Promise<AddressMemories> {
  const coins = await reader.listLiveCoins(address);
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
