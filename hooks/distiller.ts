/**
 * The distiller: turns one rendered turn into notes worth remembering by asking
 * a model. It is agnostic about which model CLI runs:
 *
 * - With no BJ_DISTILL_CMD set, it shells out to the `claude` CLI in print mode,
 *   reusing whatever auth Claude Code already has, and asks for a schema-validated
 *   JSON block (the most reliable path).
 * - With BJ_DISTILL_CMD set, it runs that command instead, piping the prompt on
 *   stdin and reading notes from stdout. Any headless agent CLI works — e.g.
 *   `BJ_DISTILL_CMD="opencode run"`, `"codex exec"`, `"grok"`, `"hermes"` — as
 *   long as it reads a prompt and writes text. parseNotes reads the reply
 *   leniently (JSON array, {remember:[...]}, a fenced block, or one note a line).
 *
 * Either way the prompt is the same model-agnostic instruction, so the notes are
 * consistent across models.
 */

import { parseMemoryOps, parseNotes } from "./distill";

const SYSTEM_PROMPT = `You distill ONE turn of an AI agent's working session into durable notes for a shared, permanent, on-chain team memory. Storage is cheap, so capture generously: record every fact a future session would be glad to already know.

Return JSON with two arrays:
- remember: third-person notes, one discrete fact per entry. Capture all of these when present: decisions made and why, problems diagnosed and their root cause, fixes applied, non-obvious gotchas or constraints learned, concrete artifacts (file paths, PR/issue numbers, txids, public addresses, command names), state changes (what shipped, merged, or closed), and the user's stated preferences or intentions. Prefer several short notes over one dense paragraph, and split independent facts into separate entries. A note longer than one coin is stored across several, so never truncate a complete thought, but do not pad. Write about the work and what was learned, not the user's exact words. Skip only pure pleasantries and restating the prompt. A substantive turn should yield several notes; return [] only when the turn genuinely carried nothing worth keeping.
- forgetIds: always [].

This memory is PUBLIC and PERMANENT. NEVER record secrets or sensitive data: no credentials, API keys, tokens, passwords, private keys or mnemonics, environment-variable or config values, connection strings, raw file contents, or personal/private information. When a fact cannot be stated without including such a value, omit it or describe it without the value (e.g. "set the API key in the env", never the key itself).`;

/** Appended for a generic CLI, which cannot enforce a schema: ask for plain JSON. */
const OUTPUT_INSTRUCTION = `Output ONLY the remember array as a JSON array of note strings, e.g. ["note one", "note two"]. No prose, no code fence, no other keys. Output [] if nothing is worth keeping.`;

const MEMORY_OPS_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    remember: { type: "array", items: { type: "string" } },
    forgetIds: { type: "array", items: { type: "string" } },
  },
  required: ["remember", "forgetIds"],
  additionalProperties: false,
});

export interface DistillerOptions {
  readonly maxBytes: number;
  readonly model?: string;
}

/**
 * Distill a turn into notes, using BJ_DISTILL_CMD when set and the bundled
 * `claude` path otherwise.
 */
export async function distill(turnText: string, options: DistillerOptions): Promise<string[]> {
  const command = process.env.BJ_DISTILL_CMD?.trim();
  return command
    ? distillViaCommand(command, turnText, options)
    : distillViaClaude(turnText, options);
}

/** Backwards-compatible alias for the bundled `claude` path. */
export const distillWithClaude = distill;

async function distillViaCommand(
  command: string,
  turnText: string,
  options: DistillerOptions,
): Promise<string[]> {
  const argv = command.split(/\s+/).filter(Boolean);
  if (argv.length === 0) throw new Error("BJ_DISTILL_CMD is empty");

  const prompt = `${SYSTEM_PROMPT}\n\n${OUTPUT_INSTRUCTION}\n\nTurn:\n\n${turnText}`;
  const proc = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(prompt);
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`distiller "${argv[0]}" exited ${exitCode}: ${stderr.trim() || "(no stderr)"}`);
  }
  return parseNotes(stdout, options.maxBytes);
}

async function distillViaClaude(turnText: string, options: DistillerOptions): Promise<string[]> {
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      `Turn:\n\n${turnText}`,
      "--model",
      options.model ?? "haiku",
      "--tools",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--setting-sources",
      "user",
      "--output-format",
      "json",
      "--json-schema",
      MEMORY_OPS_SCHEMA,
      "--system-prompt",
      SYSTEM_PROMPT,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`distiller exited ${exitCode}: ${stderr.trim() || "(no stderr)"}`);
  }
  return parseMemoryOps(stdout, options.maxBytes);
}
