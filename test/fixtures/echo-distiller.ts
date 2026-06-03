#!/usr/bin/env bun
/**
 * A stand-in distiller CLI for tests: reads the prompt on stdin (and ignores it)
 * and prints a fixed JSON array of notes on stdout, exactly the stdin -> stdout
 * contract a real model CLI follows under BJ_DISTILL_CMD.
 */
await Bun.stdin.text();
process.stdout.write('["note from the configured command", "a second note"]');

export {};
