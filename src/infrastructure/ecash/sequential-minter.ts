import { Address, Tx, toHex } from "ecash-lib";
import { ChronikClient } from "chronik-client";
import {
  type Broadcaster,
  type CoinSource,
  Minter,
  type MinterOptions,
  type SpendableCoin,
} from "./minter";
import { networkConfig, type Network, type NetworkConfig } from "./network";
import { DUST_SATS } from "./protocol";

/**
 * Minting back-to-back to one address hits the mempool's txn-mempool-conflict
 * rule: the next mint re-selects the same funding coin before the previous
 * change has propagated. This threads each broadcast's change forward as the
 * only funding coin for the next mint, so consecutive mints spend distinct coins
 * without waiting on propagation. Change is always last, so every mint path,
 * inline, pointer chunks, eMPP batches, works.
 */
export function changeThreadingMinter(
  baseCoins: CoinSource,
  baseBroadcaster: Broadcaster,
  options: MinterOptions = {},
): Minter {
  // Keyed by owner script hex, so the change of a mint to address A funds the
  // next mint to A while leaving any other address read from the base source.
  const threaded = new Map<string, SpendableCoin[]>();

  const coins: CoinSource = {
    spendableCoins: async (address) => threaded.get(scriptKey(address)) ?? baseCoins.spendableCoins(address),
  };

  const broadcaster: Broadcaster = {
    broadcast: async (rawTx) => {
      const result = await baseBroadcaster.broadcast(rawTx);
      const outputs = Tx.deser(rawTx).outputs;
      const lastIdx = outputs.length - 1;
      const change = outputs[lastIdx];
      // Only a real change coin (above dust) can fund the next mint; a tx whose
      // tail is a dust memo coin leaves nothing to thread and falls back to the
      // base source on the next read.
      if (change && change.sats > DUST_SATS) {
        threaded.set(toHex(change.script.bytecode), [
          { outpoint: { txid: result.txid, outIdx: lastIdx }, sats: change.sats },
        ]);
      }
      return result;
    },
  };

  return new Minter(coins, broadcaster, options);
}

/** A {@link changeThreadingMinter} over a network's Chronik endpoints. */
export function sequentialMinter(network?: Network | NetworkConfig, options: MinterOptions = {}): Minter {
  const config = typeof network === "object" ? network : networkConfig(network);
  const client = new ChronikClient([...config.chronikUrls]);
  const baseCoins: CoinSource = {
    spendableCoins: async (address) => {
      const { utxos } = await client.address(address).utxos();
      return utxos.map((utxo) => ({ outpoint: utxo.outpoint, sats: utxo.sats }));
    },
  };
  const baseBroadcaster: Broadcaster = { broadcast: (rawTx) => client.broadcastTx(rawTx) };
  return changeThreadingMinter(baseCoins, baseBroadcaster, options);
}

function scriptKey(address: string): string {
  return toHex(Address.fromCashAddress(address).toScript().bytecode);
}
