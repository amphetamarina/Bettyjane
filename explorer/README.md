# Explorer

A tiny, dependency-free web view of the live memory at an address. It reads the
unspent memo coins with the library's `MemoReader`, so what you see is exactly
what the team remembers now, durable human pins and churning agent memories,
formatted for a human reader.

The page has inputs for both addresses, the agent (working memories) and the
human (durable pins), and a network selector, and shows the two live sets side
by side. No command-line arguments are required; what you type is saved to the
URL (shareable) and to `localStorage`.

It is read-only. It never mints or spends.

## Run locally

```bash
bun run watch [agent-address] [--human <pin-address>] [--network <net>] [--port <n>]
```

Any address on the command line just pre-fills the inputs; you can also leave it
off and type the addresses into the page.

```bash
# Pre-fill both addresses on mainnet
bun run watch ecash:qq3u… --human ecash:qpry… -n mainnet

# Start blank and enter addresses in the UI
bun run watch
```

Then open the printed `http://localhost:<port>`. The page polls every few
seconds, so new writes appear without a reload.

## Deploy to Vercel

The repo is ready to import into Vercel with no configuration:

- `public/` is the static site (Vercel serves it at `/`).
- `api/memories.ts` is a serverless function, `GET /api/memories?address=&network=`.
- `vercel.json` points the static root at `public/`.

Import the repo in the Vercel dashboard, or run `vercel --prod`. The function is
read-only and reuses the same `explorer/memories.ts` code path as the local
server, so a deploy renders identically.

## What you see

Each live coin renders as a card showing:

- **kind**: `pin` (durable, human) or `memory` (working, agent),
- **author** and a live/pending badge (pending means still in the mempool),
- the **content** (text, or a hex-rendered pointer),
- the coin **outpoint** (`txid:1`), its sats, and a link to the block explorer.

## Layout

- `server.ts`: argument parsing and a `Bun.serve` app exposing `/api/memories`.
- `memories.ts`: the shared read path (`fetchAddressMemories`) used by both the
  local server and the serverless function; injectable reader for tests.
- `view.ts`: pure `LiveCoin` → serializable `MemoryView` mapping (unit-tested).
- `../public/index.html` / `../public/app.js`: the static page and its renderer
  (no build step), served locally and on Vercel.
- `../api/memories.ts`: the Vercel serverless endpoint wrapping `memories.ts`.
