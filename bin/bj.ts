#!/usr/bin/env bun
import "ecash-lib/dist/initNodeJs.js";
import {
  ConsensusMinter,
  DEFAULT_NAMESPACE,
  DUST_SATS,
  HashEmbedder,
  type LiveCoin,
  type LoadedMemory,
  MAX_MEMORY_BYTES,
  MalformedMemoError,
  MemoReader,
  Minter,
  UnsupportedVersionError,
  type VectoredMemory,
  assessFunding,
  coinId,
  consensus,
  decodeMemoHex,
  loadMemory,
  loadWallet,
  networkConfig,
  planConsolidation,
  sequentialMinter,
  text,
  type Memo,
  type Network,
} from "../src/index";
import { ChronikClient } from "chronik-client";
import { renderTurn } from "../capture/turn";
import { distill } from "../capture/distiller";

const NETWORKS: readonly Network[] = ["mainnet", "testnet", "regtest"];

const USAGE = `bj: Bettyjane command-line tool

Usage:
  bj load             [--network <net>] [--namespace <name>]
  bj remember <note>  [--network <net>] [--namespace <name>]
  bj forget <id>      [--network <net>] [--namespace <name>]
  bj private <note>   [--network <net>] [--namespace <name>]
  bj consensus <note> [--network <net>]
  bj capture          [--network <net>] [--transcript <file>]   (else reads the turn on stdin)
  bj consolidate      [--network <net>]
  bj pin <note>       [--network <net>]
  bj unpin <id>       [--network <net>]
  bj init             [--network <net>] [--namespace <name>] [--pin <note> ...]
  bj inspect <txid>   [--network <net>] [--json]

Options:
  -n, --network <net>   mainnet | testnet | regtest   (inspect defaults to mainnet,
                        the others default to $BJ_NETWORK or testnet)
  --namespace <name>    a named memory namespace (default reproduces the original address)
  --transcript <file>   a Claude Code transcript to render the latest turn from (capture)
  --json                machine-readable output (inspect only)
  --pin <note>          a pin to mint during init (repeatable)
  -h, --help            show help

Every command but inspect reads the wallet from BJ_MNEMONIC / BJ_NETWORK /
BJ_PASSPHRASE. remember/forget/private/capture/consolidate sign with the agent
key; pin/unpin with the human key; consensus needs both. capture distills the
turn with BJ_DISTILL_CMD (any model CLI) or the bundled claude.

These verbs are the portable core: any agent harness drives Bettyjane by shelling
out to them, no Claude Code hooks required.
`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseNetwork(value: string | undefined): Network {
  if (!NETWORKS.includes(value as Network)) {
    fail(`Invalid network: ${value}. Use one of ${NETWORKS.join(", ")}.`);
  }
  return value as Network;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "inspect":
      return runInspect(rest);
    case "load":
      return runLoad(rest);
    case "remember":
      return runRemember(rest);
    case "forget":
      return runForget(rest);
    case "private":
      return runPrivate(rest);
    case "consensus":
      return runConsensus(rest);
    case "capture":
      return runCapture(rest);
    case "consolidate":
      return runConsolidate(rest);
    case "pin":
      return runPin(rest);
    case "unpin":
      return runUnpin(rest);
    case "init":
      return runInit(rest);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error(USAGE);
      process.exit(1);
  }
}

/** Load the wallet for a write/read command, overriding the network from the flag. */
function walletFor(network: Network) {
  if (!process.env.BJ_MNEMONIC) fail("BJ_MNEMONIC is not set; export the team mnemonic first.");
  return loadWallet({ ...process.env, BJ_NETWORK: network });
}

interface CommonArgs {
  network: Network;
  namespace: string;
  transcript?: string;
  positional: string;
}

function parseCommon(args: string[]): CommonArgs {
  const out: CommonArgs = {
    network: parseNetwork(process.env.BJ_NETWORK ?? "testnet"),
    namespace: DEFAULT_NAMESPACE,
    positional: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n" || a === "--network") out.network = parseNetwork(args[++i]);
    else if (a === "--namespace") out.namespace = args[++i] ?? fail("--namespace needs a name");
    else if (a === "--transcript") out.transcript = args[++i] ?? fail("--transcript needs a file");
    else if (!a.startsWith("-")) out.positional = out.positional ? `${out.positional} ${a}` : a;
    else fail(`Unknown flag: ${a}`);
  }
  return out;
}

async function runLoad(args: string[]): Promise<void> {
  const { network, namespace } = parseCommon(args);
  const wallet = walletFor(network);
  const reader = MemoReader.fromNetwork(network);
  const memory = await loadMemory(reader, {
    pin: wallet.address("human", namespace),
    memory: wallet.address("agent", namespace),
  });
  process.stdout.write(renderMemory(network, wallet.address("agent", namespace), memory));
}

function renderMemory(network: Network, agentAddress: string, memory: LoadedMemory): string {
  const lines = [`Bettyjane memory (${network}). Agent address: ${agentAddress}`];
  lines.push(memory.pins.length ? "Pins (human, durable):" : "Pins: (none)");
  for (const pin of memory.pins) lines.push(`  - ${pin}`);
  lines.push(memory.memories.length ? "Memories (agent, working):" : "Memories: (none yet)");
  for (const m of memory.memories) lines.push(`  - [${m.id}] ${m.text}`);
  return `${lines.join("\n")}\n`;
}

async function runRemember(args: string[]): Promise<void> {
  const { network, namespace, positional: note } = parseCommon(args);
  if (!note) fail("Missing note to remember.");
  const wallet = walletFor(network);
  const { txid } = await Minter.fromNetwork(network).remember(note, wallet.signer("agent", namespace));
  console.log(`remembered "${note}" -> ${txid}`);
}

async function runForget(args: string[]): Promise<void> {
  const { network, namespace, positional: id } = parseCommon(args);
  if (!id) fail("Missing coin id (txid:vout) to forget.");
  const wallet = walletFor(network);
  const { txid } = await Minter.fromNetwork(network).forget(id, wallet.signer("agent", namespace));
  console.log(`forgot ${id} -> ${txid}`);
}

async function runPrivate(args: string[]): Promise<void> {
  const { network, namespace, positional: note } = parseCommon(args);
  if (!note) fail("Missing note to remember privately.");
  const wallet = walletFor(network);
  const signer = wallet.signer("agent", namespace);
  // Encrypt to the agent's own key so the agent can read it back.
  const { txid } = await Minter.fromNetwork(network).rememberPrivate(note, signer.pubkey, signer);
  console.log(`remembered privately -> ${txid}`);
}

async function runConsensus(args: string[]): Promise<void> {
  const { network, positional: note } = parseCommon(args);
  if (!note) fail("Missing note for the consensus memo.");
  const wallet = walletFor(network);
  const agent = wallet.signer("agent");
  const human = wallet.signer("human");
  const signers = [
    { pubkey: agent.pubkey, seckey: agent.seckey },
    { pubkey: human.pubkey, seckey: human.seckey },
  ];
  const prefix = networkConfig(network).prefix;
  const { txid } = await ConsensusMinter.fromNetwork(network).mint(consensus(text(note)), signers, prefix);
  console.log(`consensus "${note}" -> ${txid}`);
}

/** How much of a rendered turn to hand the distiller; bounds the model's input. */
const TURN_BUDGET = 16000;

async function runCapture(args: string[]): Promise<void> {
  const { network, namespace, transcript } = parseCommon(args);
  const turn = transcript
    ? renderTurn((await Bun.file(transcript).text()).split("\n"), TURN_BUDGET)
    : (await Bun.stdin.text()).trim();
  if (!turn) {
    console.error("capture: empty turn, nothing to distill");
    return;
  }
  const notes = await distill(turn, { maxBytes: MAX_MEMORY_BYTES });
  if (notes.length === 0) {
    console.error("capture: distiller found nothing worth keeping");
    return;
  }
  const wallet = walletFor(network);
  const signer = wallet.signer("agent", namespace);
  // A change-threading minter so a turn's notes mint back to back without conflict.
  const minter = sequentialMinter(network);
  for (const note of notes) {
    const { txid } = await minter.remember(note, signer);
    console.log(`remembered "${note}" -> ${txid}`);
  }
}

const SIMILARITY_THRESHOLD = 0.9;

async function runConsolidate(args: string[]): Promise<void> {
  const { network, namespace } = parseCommon(args);
  const wallet = walletFor(network);
  const reader = MemoReader.fromNetwork(network);
  const address = wallet.address("agent", namespace);
  const coins = await reader.listLiveCoins(address);
  const stale = planConsolidation(await vectoredMemories(reader, coins), SIMILARITY_THRESHOLD);
  if (stale.length === 0) {
    console.error("consolidate: no near-duplicates to tidy");
    return;
  }
  const minter = Minter.fromNetwork(network);
  const signer = wallet.signer("agent", namespace);
  for (const id of stale) {
    const { txid } = await minter.forget(id, signer);
    console.log(`forgot near-duplicate ${id} -> ${txid}`);
  }
}

async function vectoredMemories(reader: MemoReader, coins: readonly LiveCoin[]): Promise<VectoredMemory[]> {
  const embedder = new HashEmbedder();
  const memories: VectoredMemory[] = [];
  for (const coin of coins) {
    memories.push({ id: coinId(coin.outpoint), vector: await embedder.embed(await reader.resolveText(coin)) });
  }
  return memories;
}

async function runPin(args: string[]): Promise<void> {
  let note = "";
  let network = parseNetwork(process.env.BJ_NETWORK ?? "testnet");
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n" || a === "--network") network = parseNetwork(args[++i]);
    else if (!a.startsWith("-")) note = note ? `${note} ${a}` : a;
    else fail(`Unknown flag: ${a}`);
  }
  if (!note) fail("Missing note to pin.");

  const wallet = walletFor(network);
  const { txid } = await Minter.fromNetwork(network).pin(note, wallet.signer("human"));
  console.log(`pinned "${note}" -> ${txid}`);
}

async function runUnpin(args: string[]): Promise<void> {
  let id = "";
  let network = parseNetwork(process.env.BJ_NETWORK ?? "testnet");
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n" || a === "--network") network = parseNetwork(args[++i]);
    else if (!a.startsWith("-")) id = a;
    else fail(`Unknown flag: ${a}`);
  }
  if (!id) fail("Missing pin id (txid:vout) to unpin.");

  const wallet = walletFor(network);
  const { txid } = await Minter.fromNetwork(network).unpin(id, wallet.signer("human"));
  console.log(`unpinned ${id} -> ${txid}`);
}

async function runInit(args: string[]): Promise<void> {
  let network = parseNetwork(process.env.BJ_NETWORK ?? "testnet");
  let namespace = DEFAULT_NAMESPACE;
  const pins: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n" || a === "--network") network = parseNetwork(args[++i]);
    else if (a === "--namespace") namespace = args[++i] ?? fail("--namespace needs a name");
    else if (a === "--pin") pins.push(args[++i] ?? fail("--pin needs a note"));
    else fail(`Unknown flag: ${a}`);
  }

  const wallet = walletFor(network);
  const human = wallet.address("human", namespace);
  const agent = wallet.address("agent", namespace);
  const config = networkConfig(network);
  const client = new ChronikClient([...config.chronikUrls]);

  const fundingOf = async (address: string) => {
    const { utxos } = await client.address(address).utxos();
    return assessFunding(
      utxos.map((u) => ({ sats: u.sats, confirmed: u.blockHeight !== -1 })),
      { minimumSats: DUST_SATS * 3n }, // a coin's dust plus headroom for the fee
    );
  };

  const reader = MemoReader.fromNetwork(network);
  const [humanFunding, agentFunding, livePins, memories] = await Promise.all([
    fundingOf(human),
    fundingOf(agent),
    reader.listLiveCoins(human),
    reader.listLiveCoins(agent),
  ]);

  console.log(`Bettyjane wallet (${network}${namespace === DEFAULT_NAMESPACE ? "" : `, namespace "${namespace}"`})`);
  console.log(`  human / pin address:    ${human}`);
  console.log(`    funding: ${humanFunding.totalSats} sats (${humanFunding.funded ? "funded" : "NOT funded, fund this to pin"}), live pins: ${livePins.length}`);
  console.log(`  agent / memory address: ${agent}`);
  console.log(`    funding: ${agentFunding.totalSats} sats (${agentFunding.funded ? "funded" : "NOT funded, fund this to capture"}), live memories: ${memories.length}`);

  if (pins.length === 0) {
    console.log("\nFund the addresses above, then re-run with --pin to mint initial pins (signed with the human key).");
    return;
  }
  // Pins are signed with the human key, so the human address must be funded.
  if (!humanFunding.funded) fail("\nThe human/pin address is not funded yet; fund it before minting pins.");

  const results = await Minter.fromNetwork(network).mintAll(
    pins.map((p) => ({ kind: "pin" as const, content: { type: "text" as const, text: p } })),
    wallet.signer("human", namespace),
  );
  for (const r of results) console.log(`pinned -> ${r.txid}`);
}

interface InspectResult {
  txid: string;
  network: Network;
  block?: { height: number; hash: string; timestamp: number };
  opReturn: { sats: bigint; scriptHex: string };
  memoCoin: { outpoint: string; sats: bigint; spentBy?: string; live: boolean };
  memo: Memo | null;
  error?: string;
}

async function runInspect(args: string[]): Promise<void> {
  let txid = "";
  let network: Network = "mainnet";
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "-n" || a === "--network") {
      const val = args[++i];
      if (val !== "mainnet" && val !== "testnet" && val !== "regtest") {
        fail(`Invalid network: ${val}. Use mainnet, testnet, or regtest.`);
      }
      network = val;
    } else if (!a.startsWith("-")) {
      if (txid) fail("Only one txid is supported");
      txid = a;
    } else fail(`Unknown flag: ${a}`);
  }

  if (!txid) fail("Missing txid");
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) fail(`Invalid txid (expected 64 hex chars): ${txid}`);

  const result = await inspectTx(txid.toLowerCase(), network);
  if (json) {
    console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    process.exit(result.error ? 1 : 0);
  }
  printHuman(result);
  process.exit(result.error ? 1 : 0);
}

async function inspectTx(txid: string, network: Network): Promise<InspectResult> {
  const config = networkConfig(network);
  const client = new ChronikClient([...config.chronikUrls]);

  let tx;
  try {
    tx = await client.tx(txid);
  } catch (e: any) {
    return {
      txid,
      network,
      opReturn: { sats: 0n, scriptHex: "" },
      memoCoin: { outpoint: `${txid}:1`, sats: DUST_SATS, live: false },
      memo: null,
      error: `Failed to fetch tx from Chronik: ${e?.message ?? e}`,
    };
  }

  const opReturn = tx.outputs[0];
  const memoOut = tx.outputs[1];

  const result: InspectResult = {
    txid,
    network,
    block: tx.block ?? undefined,
    opReturn: { sats: opReturn?.sats ?? 0n, scriptHex: opReturn?.outputScript ?? "" },
    memoCoin: {
      outpoint: `${txid}:1`,
      sats: memoOut?.sats ?? DUST_SATS,
      spentBy: memoOut?.spentBy ? `${memoOut.spentBy.txid}:${memoOut.spentBy.outIdx}` : undefined,
      live: !memoOut?.spentBy,
    },
    memo: null,
  };

  if (!opReturn) {
    result.error = "Transaction has no outputs";
    return result;
  }

  try {
    const memo = decodeMemoHex(opReturn.outputScript);
    result.memo = memo;
    if (!memo) result.error = "Not a Bettyjane memo (different LOKAD ID or not OP_RETURN)";
  } catch (e: any) {
    if (e instanceof MalformedMemoError || e instanceof UnsupportedVersionError) {
      result.error = `Malformed Bettyjane memo: ${e.message}`;
    } else {
      result.error = `Decode error: ${e?.message ?? e}`;
    }
  }

  return result;
}

function printHuman(r: InspectResult) {
  console.log(`\n${r.txid}  (${r.network})`);
  if (r.block) {
    console.log(`block ${r.block.height}  ${new Date(r.block.timestamp * 1000).toISOString()}`);
  } else {
    console.log("in mempool / unconfirmed");
  }
  console.log("");

  if (r.error && !r.memo) {
    console.log(`! ${r.error}`);
    console.log(`OP_RETURN script: ${r.opReturn.scriptHex}`);
    return;
  }

  const liveBadge = r.memoCoin.live ? "LIVE" : "SPENT";
  console.log(`memo coin: ${r.memoCoin.outpoint}   (${r.memoCoin.sats} sats, ${liveBadge})`);
  if (r.memoCoin.spentBy) console.log(`  spent by: ${r.memoCoin.spentBy}`);
  console.log("");

  if (!r.memo) {
    console.log("No parsable Bettyjane memo found.");
    return;
  }

  console.log(`kind:  ${r.memo.kind}`);
  console.log(`type:  ${r.memo.content.type}`);
  console.log("");
  if (r.memo.content.type === "text") console.log(r.memo.content.text);
  else console.log(`pointer: ${Buffer.from(r.memo.content.pointer).toString("hex")}`);
  console.log("");
  console.log(`OP_RETURN: ${r.opReturn.scriptHex}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
