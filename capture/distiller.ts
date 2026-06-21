/**
 * Distills a turn into notes by asking a model. BJ_DISTILL_CMD, when set, names
 * the CLI to run (prompt on stdin, notes on stdout); otherwise it shells out to
 * `claude` and requests a schema-validated JSON block.
 */

import { parseMemoryOps, parseNotes } from "./turn";

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

export async function distill(turnText: string, options: DistillerOptions): Promise<string[]> {
  const command = process.env.BJ_DISTILL_CMD?.trim();
  return command
    ? distillViaCommand(command, turnText, options)
    : distillViaClaude(turnText, options);
}

/** Backwards-compatible alias. */
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
