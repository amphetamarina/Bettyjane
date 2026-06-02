# Bettyjane

A persistent, public, tamper-proof memory for a human-plus-agent team, living on eCash (XEC). In this version every memory is a coin. Built to be understood and run, not admired.

---

## The one idea

An LLM has amnesia. Claude, GPT, any of them, forget everything the moment a call ends. They are brilliant and they wake up with a blank mind every single time.

So we give the team a notebook, except the notebook is made of coins. Each memory is a tiny coin sitting on the eCash chain. The agent's mind, right now, is the handful of coins it currently holds. To forget something, it spends that coin and the coin leaves the table. The spending is recorded forever, so nothing is truly destroyed, it is just no longer in hand.

The agent is not a program running on the blockchain. The agent is the set of coins it holds and the trail of how that set changed. Its identity and memory are the chain. Its thinking happens elsewhere.

---

## The three pieces

Think of an old game console.

1. **The notebook = coins on the eCash chain.** The save file. The team's identity, its current memories, and the full history of every change. The chain keeps it safe and ordered for free.

2. **The brain = an LLM API.** The console, the thing that plays. Claude Code, the Claude API, any agent framework. It has no memory of its own. You hand it the current coins as text, it thinks, it tells you what to remember and what to forget.

3. **The runner = whatever advances a turn.** Your own small loop, or, when you use Claude Code, two hook scripts that fire on their own. Without it the coins just sit there, frozen between turns.

---

## What is in the notebook

**Each memory is a coin.** A memory is a dust coin (a tiny fixed amount of XEC) sitting at the agent's memory address, with its text attached when it was minted. The coins the agent holds right now, the unspent ones, are its current memory. You read them in a single call: list the live coins at that address.

**Forgetting is spending.** To drop a memory, spend its coin. The dust comes back to the agent's wallet, the coin disappears from the live set, and the act of spending stays in history. So "what do I remember now" is the live set, and "what did I once know" is the full chain.

Analogy: the agent's mind is a small pile of coins on a table. Remembering lays a new coin down. Forgetting picks one up and pockets it. A photo of the table is taken at every change, so you can always see what it held last week.

**The live set is the pool. The working set is smaller.** The live coins are already curated, because you spent the junk. But you still do not pour all of them into the prompt, because long context makes the brain worse and costs more. Each turn the brain sees a small working set: the human's pins, plus the few live coins most relevant right now, picked by a simple search index. How many is a knob, set by what the model uses well, a low number, maybe a couple dozen. It is not set by any limit on the chain.

---

## Two pens: the human and the agent

The notebook has two authors, and that is a small change, because writing a coin is the only mechanism either pen needs.

**Two keys, two piles.** The agent's memory coins live at one address, controlled by the agent's key. The human's pins live at a second address, controlled by the human's key. Both sit on the same chain, and every coin carries the signature of whoever minted it, so you always know who wrote what.

**Two roles, on purpose.** The agent keeps fast, churning working memories. The human pins rare, durable things: corrections, standing instructions, facts the agent keeps getting wrong. Because pins live at the human's address, the agent's key cannot spend them. It can read a pin and obey it. It cannot erase it.

Analogy: the agent's coins churn on the table. The human's coins are glued to the corner. The agent reads all of them and only ever pockets its own.

**Four verbs, split by key.**

- Agent: `remember(note)` mints a memory coin, `forget(id)` spends one.
- Human: `pin(note)` mints a pin coin, `unpin(id)` spends one.

The signature is the permission. There is no access system to build.

---

## How it is bound to the quine

When you later wrap this in the self-replicating quine covenant, the memory is bound by ownership. The same key that controls the agent's identity coin controls its memory coins. Spend authority over the memory is spend authority over the agent, one key, one will.

If you ever need to prove to a stranger that the agent's memory at some past moment was exactly a certain set, without them rebuilding the live set from history, add a commitment to that set inside the quine's signed state. That is extra machinery, so leave it out until something actually needs it.

---

## How the agent is born

You create two things: the agent, and its first pins.

Fund the agent's memory address with a little XEC, enough to mint many coins and pay the tiny fees. Mint a couple of pins from the human key to start: the agent's name, its goal, a standing instruction or two. The moment those transactions finalize, about 2 to 3 seconds later, the agent exists, holding its first coins, waiting for its first session.

Lighting the pilot light.

---

## Running it inside Claude Code

Claude Code already gives you the loop, so you do not write a runner. You write three small scripts and let Claude Code's hooks fire them. Bundle them as a plugin and the whole memory layer installs at once.

Three hooks do the work:

- **SessionStart** fires when a session begins. It reads the live coins and the pins from the chain and prints them, and that printed text becomes Claude's context. The agent wakes up already knowing.
- **Stop** fires after every response. It captures just that turn: if anything is worth keeping or anything went stale, it mints or spends a coin. Most turns write nothing.
- **SessionEnd** fires once when the session closes. It tidies up: merge near-duplicate coins, spend the stale ones.

A note on cadence. On XEC a write is sub-cent and final in seconds, so cost is not the reason to wait for the end. The reason to be careful is noise. A memory written after every reply tends to capture half-finished thoughts and duplicates, and a live set full of that makes retrieval worse. So `Stop` writes per turn but only a distilled delta, usually a no-op, while `SessionEnd` consolidates. `Stop` captures, `SessionEnd` tidies. Per-turn capture also means a crash loses at most one turn, not the whole session, which is what makes a disposable runner safe. Point `StopFailure` at the same capture script so dead ends get remembered too.

The plugin's `hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command",
          "command": "node ${CLAUDE_PLUGIN_ROOT}/load.js", "timeout": 30 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command",
          "command": "node ${CLAUDE_PLUGIN_ROOT}/capture.js", "timeout": 30 }] }
    ],
    "StopFailure": [
      { "hooks": [{ "type": "command",
          "command": "node ${CLAUDE_PLUGIN_ROOT}/capture.js", "timeout": 30 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command",
          "command": "node ${CLAUDE_PLUGIN_ROOT}/consolidate.js", "timeout": 60 }] }
    ]
  }
}
```

`load.js`, the wake-up. Its stdout becomes context:

```js
// SessionStart: read memory from the chain, print it as context.
// listLiveCoins / retrieveRelevant are your helpers over Chronik + the index.
const pins   = await listLiveCoins(PIN_ADDR);      // human, durable
const memory = await listLiveCoins(MEMORY_ADDR);   // agent, working pool
const hits   = retrieveRelevant(memory, MAX_WORKING - pins.length);

console.log([
  "## Standing notes from Marina (do not contradict)",
  ...pins.map((p) => `- ${p.text}`),
  "## What you remember",
  ...hits.map((m) => `- ${m.text}`),
].join("\n"));
process.exit(0);
```

`capture.js`, the per-turn write. It looks at the latest turn only and usually does nothing:

```js
// Stop / StopFailure: capture just this turn's delta. Write only if non-empty.
// distillTurn is cheap (small model or rules); it runs on every turn.
const input = JSON.parse(readStdin());             // { transcript_path, ... }
const turn = lastTurn(input.transcript_path);      // the latest exchange only

(async () => {
  const { remember, forgetIds } = await distillTurn(turn);  // often returns nothing
  for (const note of remember)  await mintCoin(MEMORY_ADDR, note); // remember
  for (const id   of forgetIds) await spendCoin(id);              // forget
})();                                              // backgrounded, do not block

process.exit(0);
```

`consolidate.js`, the tidy-up. It runs at session end (or every N turns):

```js
// SessionEnd: merge near-duplicate coins and drop the stale, gated by similarity
// so it never summarizes away something still distinct.
(async () => {
  const memory = await listLiveCoins(MEMORY_ADDR);
  const { merges, drops } = await consolidate(memory);
  for (const m of merges) {
    await mintCoin(MEMORY_ADDR, m.summary);
    for (const id of m.sourceIds) await spendCoin(id);
  }
  for (const id of drops) await spendCoin(id);
})();

process.exit(0);
```

The human's two verbs are a tiny CLI signed with the human key, or a plugin slash command:

```
notebook pin   "Always cite the eCash upgrade date as 2025-11-15."
notebook unpin <coin-id>
```

What a session feels like: you run `claude`, and it opens already knowing its standing notes and recent memory, because SessionStart loaded them. As you work, it lays down a coin whenever a turn produces something worth keeping, because Stop captured it. When you close the session it tidies the pile, because SessionEnd consolidated. Nothing lived on your laptop, and if it had crashed mid-session it would have lost at most one turn. You can watch the memory change in real time by listing the agent's live coins.

---

## Plugging in any other agent

The whole connection is two functions, and the hooks above are just one way to call them.

```
loadMemory()  ->  read the chain, return pins plus the top-K live coins as text.
                  (SessionStart, or paste into any system prompt.)
saveMemory(remember, forget)  ->  mint and spend coins on the chain.
                  (Stop, per turn, or call at the end of any agent turn.)
```

For a raw model API, put the loaded text in the system prompt and ask the model to end its reply with a small JSON block of memory operations, then call `saveMemory`. The brain is interchangeable. Swap Claude for anything and the coins do not change.

---

## You do not need the covenant to start

The full quine covenant is the destination, not the starting line.

Start with keys. The agent holds its key, the human holds theirs, and the runner (or the hooks) mints and spends coins each turn. Self-replication of the identity coin is a rule the runner follows, not something the chain forces yet. You trust your own keys. That is fine for a persistent, public, tamper-evident, two-author memory, and you can run it this week.

Upgrade later. Wrap the identity coin in the recursive covenant so no single mistake can make the agent deviate. The memory model does not change, because memory was always just coins owned by the agent's key.

---

## What you give up to keep it simple

- The search index is off chain. It is a cache, not the truth. Embed each coin's text when you mint it, key the vector by the coin id, and rebuild the index from the chain whenever you want. Losing it costs nothing permanent.
- The live set is your on-chain footprint. Every memory you keep is a coin in the chain's coin set. Spend to forget, both to free the dust and to keep the footprint lean. This is fine at artifact scale and antisocial at millions of coins.
- The brain still runs off chain. The chain is the memory and the referee. It is not the compute.

---

## Why bother (the payoff)

- **The runner is disposable. The agent is not.** Kill the runner, lose the laptop, the server dies. The team's whole memory is on the chain as coins. Point a fresh runner at the same addresses and it wakes up exactly where it left off.
- **Its mind is a public query.** Anyone can list the agent's live coins and see exactly what it remembers right now, and read the chain to see how it got there. No trust required.
- **One auditable record of who steered and when.** Replay the chain and watch the human's pins shape the agent, turn by turn, all signed and timestamped. A repeated mistake and a repeated correction are right there.
- **Nobody can quietly tamper with it.** Every change is a signed transaction. If two runners ever conflict, Avalanche decides which is real, in seconds.

---

## Two tips

**When a memory will not fit on one coin.** Mint the coin with a pointer instead of the text: a short tag plus the transaction id where the full content was written once. To read it back, jump straight to that transaction. The coin stays tiny and the content can be any size. Carry the pointer, let the chain be the storage room.

**Keep the human pins few and durable.** The point of the small working set was that context cannot grow forever. Pins are a separate layer with the same discipline. Few, durable, retire the stale ones. If the human glues long messages to the corner, you have rebuilt the unbounded-context problem with two keys and extra steps.