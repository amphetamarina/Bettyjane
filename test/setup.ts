/**
 * Test preload: initialize ecash-lib's WebAssembly once, before any test file
 * runs. Without this, each test file lazily triggers the wasm init on its first
 * crypto call, and under Bun's parallel file execution those concurrent inits
 * race, surfacing as an intermittent "recursive use of an object" / "out of
 * bounds memory access" in pbkdf2/sha512. Initializing up front makes the suite
 * deterministic. Wired via bunfig.toml [test].preload.
 */
import "ecash-lib/dist/initNodeJs.js";
