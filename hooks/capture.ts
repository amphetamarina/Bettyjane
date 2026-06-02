#!/usr/bin/env bun
/**
 * Stop hook: remember the turn that just ended as on-chain memory.
 *
 * Renders the latest turn and hands it to a backgrounded worker that distils it
 * with a model and mints what is worth keeping. The model call takes seconds, so
 * the worker runs detached: this hook writes the turn to a temp file, spawns the
 * worker, and returns immediately, never blocking the end of a turn. A crash
 * loses at most the current turn's memory.
 *
 * Opt-in: it does nothing unless BJ_CAPTURE is truthy AND a wallet is
 * configured, because every memory spends real value and — on mainnet — is
 * public and permanent. It always exits 0; any failure is reported on stderr.
 *
 * Configure with BJ_CAPTURE=1 plus BJ_MNEMONIC / BJ_NETWORK (see hooks/README.md).
 */

import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTurn } from "./distill";

const ENABLED = new Set(["1", "true", "yes"]);
// Bytes of turn text handed to the distiller. Bounds the model's input cost; the
// user's ask sits at the head and survives truncation. Generous enough that a
// long, substantive turn reaches the distiller whole, so it can mint several
// notes rather than only what fit in a small head slice.
const TURN_BUDGET = 16000;

interface StopPayload {
  readonly transcript_path?: string;
  readonly stop_hook_active?: boolean;
}

async function main(): Promise<void> {
  if (!ENABLED.has((process.env.BJ_CAPTURE ?? "").toLowerCase())) return;
  if (!process.env.BJ_MNEMONIC) return;

  const payload = JSON.parse(await Bun.stdin.text()) as StopPayload;
  if (payload.stop_hook_active || !payload.transcript_path) return;

  const lines = (await Bun.file(payload.transcript_path).text()).split("\n");
  const turn = renderTurn(lines, TURN_BUDGET);
  if (!turn) return;

  const dir = process.env.CLAUDE_PROJECT_DIR ?? ".";
  const turnFile = join(tmpdir(), `bettyjane-turn-${process.pid}-${Date.now()}.txt`);
  await Bun.write(turnFile, turn);
  const logFd = openSync(join(dir, "hooks", ".capture.log"), "a");

  const worker = Bun.spawn(["bun", join(dir, "hooks", "distill-worker.ts"), turnFile], {
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    env: process.env,
  });
  worker.unref();
}

main().catch((error) => {
  process.stderr.write(`bettyjane capture hook: ${error}\n`);
});
