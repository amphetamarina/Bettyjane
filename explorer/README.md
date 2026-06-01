# Explorer

A tiny, dependency-free web view of the live memory at an address. It reads the
unspent memo coins with the library's `MemoReader`, so what you see is exactly
what the team remembers now — durable human pins and churning agent memories,
formatted for a human reader.

It is read-only. It never mints or spends.

## Run

```bash
bun run watch <address> [--network mainnet|testnet|regtest] [--port 4173]
```

Examples:

```bash
# Watch the agent's memory address on mainnet
bun run watch ecash:qq3uztqjnnkqqaq7tqh2gejr8j2xersq95k4d5a260 -n mainnet

# Testnet, on a custom port
bun run watch ectest:qq... --network testnet --port 4200
```

Then open the printed `http://localhost:<port>`. The page polls every few
seconds, so new writes appear without a reload.

## What you see

Each live coin renders as a card showing:

- **kind** — `pin` (durable, human) or `memory` (working, agent),
- **author** and a live/pending badge (pending means still in the mempool),
- the **content** (text, or a hex-rendered pointer),
- the coin **outpoint** (`txid:1`), its sats, and a link to the block explorer.

## Layout

- `server.ts` — argument parsing and a `Bun.serve` app exposing `/api/memories`.
- `view.ts` — pure `LiveCoin` → serializable `MemoryView` mapping (unit-tested).
- `index.html` / `app.js` — the static page and its renderer (no build step).
