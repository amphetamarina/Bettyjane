import { coinId } from "../domain/coin-id";
import { DEFAULT_MAX_WORKING, retrieveRelevant } from "../domain/retrieval";
import type { LiveCoin } from "../infrastructure/ecash/reader";
import type { MintResult, SpendResult } from "../infrastructure/ecash/minter";
import type { Signer } from "../infrastructure/ecash/wallet";

export interface MemorySource {
  listLiveCoins(address: string): Promise<LiveCoin[]>;
  resolveText(coin: LiveCoin): Promise<string>;
}

export interface MemoryWriter {
  remember(value: string, signer: Signer): Promise<MintResult>;
  forget(id: string, signer: Signer): Promise<SpendResult>;
}

export interface MemoryAddresses {
  readonly pin: string;
  readonly memory: string;
}

export interface LoadMemoryOptions {
  readonly maxWorking?: number;
}

/** Coin id is kept so the memory can later be forgotten. */
export interface LoadedCoin {
  readonly id: string;
  readonly text: string;
}

export interface LoadedMemory {
  readonly pins: string[];
  readonly memories: LoadedCoin[];
}

/**
 * Returns every pin and at most `maxWorking` memories as resolved text (pointer
 * memories are reassembled). With no query the working set is the first
 * `maxWorking` live memories; query-time ranking is layered on by the caller.
 */
export async function loadMemory(
  source: MemorySource,
  addresses: MemoryAddresses,
  options: LoadMemoryOptions = {},
): Promise<LoadedMemory> {
  const k = options.maxWorking ?? DEFAULT_MAX_WORKING;
  const [pinCoins, memoryCoins] = await Promise.all([
    source.listLiveCoins(addresses.pin),
    source.listLiveCoins(addresses.memory),
  ]);

  const working = retrieveRelevant(
    memoryCoins.map((coin) => ({ id: coinId(coin.outpoint), coin })),
    k,
  );

  const [pins, memories] = await Promise.all([
    Promise.all(pinCoins.map((coin) => source.resolveText(coin))),
    Promise.all(
      working.map(async (entry) => ({ id: entry.id, text: await source.resolveText(entry.coin) })),
    ),
  ]);
  return { pins, memories };
}

export interface MemoryOps {
  readonly remember?: readonly string[];
  readonly forget?: readonly string[];
}

export interface SaveResult {
  readonly minted: MintResult[];
  readonly forgot: SpendResult[];
}

/**
 * Mint each remembered note (a long note spans a pointer chain), then forget
 * each named coin. Sequential because each write spends the change the previous
 * one left behind.
 */
export async function saveMemory(
  writer: MemoryWriter,
  signer: Signer,
  ops: MemoryOps,
): Promise<SaveResult> {
  const minted: MintResult[] = [];
  for (const note of ops.remember ?? []) minted.push(await writer.remember(note, signer));
  const forgot: SpendResult[] = [];
  for (const id of ops.forget ?? []) forgot.push(await writer.forget(id, signer));
  return { minted, forgot };
}
