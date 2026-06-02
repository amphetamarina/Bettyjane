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

const SYSTEM_PROMPT = `You distill ONE turn of an AI agent's working session into durable notes for a shared, permanent, on-chain team memory. Storage is cheap, so capture generously: record every fact a future session would be glad to already know.

Return JSON with two arrays:
- remember: third-person notes, one discrete fact per entry. Capture all of these when present: decisions made and why, problems diagnosed and their root cause, fixes applied, non-obvious gotchas or constraints learned, concrete artifacts (file paths, PR/issue numbers, txids, public addresses, command names), state changes (what shipped, merged, or closed), and the user's stated preferences or intentions. Prefer several short notes over one dense paragraph, and split independent facts into separate entries. A note longer than one coin is stored across several, so never truncate a complete thought, but do not pad. Write about the work and what was learned, not the user's exact words. Skip only pure pleasantries and restating the prompt. A substantive turn should yield several notes; return [] only when the turn genuinely carried nothing worth keeping.
- forgetIds: always [].

This memory is PUBLIC and PERMANENT. NEVER record secrets or sensitive data: no credentials, API keys, tokens, passwords, private keys or mnemonics, environment-variable or config values, connection strings, raw file contents, or personal/private information. When a fact cannot be stated without including such a value, omit it or describe it without the value (e.g. "set the API key in the env", never the key itself).`;

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
