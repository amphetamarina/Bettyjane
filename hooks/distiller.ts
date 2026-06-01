/**
 * The distiller: turns one rendered turn into notes worth remembering by asking
 * a model. Rather than a raw API client and an API key, it shells out to the
 * `claude` CLI in print mode, reusing whatever auth the human already runs
 * Claude Code with. The CLI is told to emit a schema-validated memory-ops block
 * as JSON, which parseMemoryOps reads.
 *
 * Two flags keep the call cheap and safe: a replacement --system-prompt (not an
 * append) drops the full Claude Code system prompt, and --setting-sources user
 * loads only user settings, so the project's own Stop hook never runs inside
 * this child and capture cannot recurse into itself.
 */

import { parseMemoryOps } from "./distill";

const SYSTEM_PROMPT = `You distill ONE turn of an AI agent's working session into durable notes for a shared, permanent, on-chain team memory.

Return JSON with two arrays:
- remember: short third-person notes (each under ~180 characters) about what was decided, learned, or done this turn that a future session would need to know. Write about the agent's work, not the user's exact words. Skip pleasantries, restating the prompt, and anything ephemeral. Return [] when nothing this turn is worth keeping; most turns are not.
- forgetIds: always [].`;

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

export async function distillWithClaude(turnText: string, options: DistillerOptions): Promise<string[]> {
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
