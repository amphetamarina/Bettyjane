# AGENTS.md

Guidance for agents and contributors working in this repository. For what
Bettyjane is and how to use it, read [README.md](README.md); for the design,
[docs/INITIAL_SPEC.md](docs/INITIAL_SPEC.md).

## Commands

The toolchain (Bun 1.2) is pinned with [mise](https://mise.jdx.dev). Run
everything through it so versions match CI.

```bash
mise install        # install the pinned Bun
mise run install    # bun install
mise run test       # bun test
mise run typecheck  # bun run tsc --noEmit
```

Run a single test file with `mise exec -- bun test test/minter.test.ts`.

Both `mise run test` and `mise run typecheck` must pass before a change is done;
CI runs the same two on every PR and push to `main`.

## Architecture

Domain-driven layering, enforced by import direction:

- `src/domain/` — the pure memory model: `Memo`/`MemoContent`, `Author`, and
  funding assessment. No eCash, no I/O, no `ecash-lib` imports. Chain-agnostic
  and trivially unit-testable.
- `src/infrastructure/ecash/` — the adapters that bind the model to eCash:
  `wallet` (key/address derivation), `memo-codec` + `protocol` (the OP_RETURN
  format), `chronik` (reads), `minter` (writes — build/sign/broadcast),
  `network` (prefixes and endpoints).
- `src/index.ts` — the public surface. Every export the package offers is
  re-exported here; add new public types/functions to it.

Infrastructure may depend on the domain; the domain must never depend on
infrastructure. Keep new chain-agnostic logic in `domain/`.

Adapters take their external systems as narrow injected interfaces (e.g.
`UtxoSource`, `CoinSource`, `Broadcaster`, `Clock`) so they can be driven by a
real client or a fake. Use `*.fromNetwork()` factories for real wiring and the
plain constructor for tests.

## Conventions

- **TypeScript on Bun**, ES modules, strict. Prefer `readonly` fields and small
  immutable value objects.
- **Let types and names carry meaning.** Comment only genuinely non-obvious
  decisions (a protocol quirk, a wire-format reason) — not what the code already
  says. Match the density of the surrounding file.
- **Errors are named classes** that extend `Error` and set `this.name`
  (`MemoTooLargeError`, `FundingTimeoutError`, `InsufficientFundsError`), thrown
  with context callers can inspect.
- **Tests** use `bun:test`, one suite file per module under `test/`, named for
  behavior. Derive keys inside `test`/`beforeAll` bodies, never at module top
  level (see gotchas).
- **Commits** are atomic and Conventional (`feat:`, `fix:`, `docs:`, `ci:`),
  with an `(AMP-NNN)` suffix when a Linear issue applies. One revertable unit per
  commit. Each issue ships as a branch and PR off `main`.

## eCash / ecash-lib gotchas

- The native WASM (ECC, hashers) wires up on `import ... from "ecash-lib"`, but
  is not reliably ready at **module-eval time**. Deriving keys or signing at the
  top level of a file can throw `RuntimeError: Out of bounds memory access` in
  `sha512h_finalize`. Do that work inside functions / `beforeAll`, not in
  module-scope constants.
- `pushBytesOp` uses **minimal-push** encoding: a single-byte push of a small
  integer (1–16, or 0x81) collapses to a bare `OP_N` opcode, not a data push.
  Pack fixed small-int header fields into one multi-byte push so they round-trip.
  This is why the memo header is a single 3-byte push.
- Confirmed constants from the installed lib: `OP_RETURN_MAX_BYTES = 223`,
  `DEFAULT_DUST_SATS = 546n`, `DEFAULT_FEE_SATS_PER_KB = 1000n`.
- Protocol invariant the minter relies on: **a memo coin holds exactly
  `DUST_SATS`; funding/change coins hold more.** The minter spends only coins
  above dust, so minting never spends an existing memory. Preserve this when
  touching coin selection or output layout (OP_RETURN, then the dust memo coin,
  then change).
- The flake above (`Out of bounds memory access` via `mnemonicToSeed`) can still
  surface rarely under a full `bun test` run. It is upstream, not our code — if a
  run fails only there, re-run.
