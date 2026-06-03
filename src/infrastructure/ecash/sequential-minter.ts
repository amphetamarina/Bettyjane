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
 * Minting many memories back to back to one address hits the mempool's
 * txn-mempool-conflict rule: each {@link Minter.mint} re-reads the address's
 * UTXOs and picks the largest funding coin, but a just-broadcast change output
 * has not propagated yet, so the next mint re-selects the same coin and tries to
 * spend it twice. A whole turn's worth of captured notes fails this way.
 *
 * This wraps a base {@link CoinSource} and {@link Broadcaster} so that after each
 * broadcast the transaction's change output is threaded forward as the only
 * funding coin for the next mint. Consecutive mints therefore spend distinct,
 * known coins and never conflict — without waiting on chain propagation. The
 * minter always places change last, so this holds for every mint path: inline,
 * pointer-chain chunks, and eMPP batches.
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

/**
 * A {@link changeThreadingMinter} backed by a network's Chronik endpoints — the
 * conflict-free minter to use when writing several memories in one run, such as a
 * turn's captured notes.
 */
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
