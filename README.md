# UTXO Memory Layer (UML) for eCash

A brutally efficient, consensus-anchored memory layer for an autonomous agent that lives as a quine covenant on eCash (XEC). UML is not a standalone contract. It is a module of the quine's carried state, so a single signature authorizes both a cognition step and a memory mutation, and the agent's memory history and cognition history are literally the same chain.

Status: design spec, pre-implementation. Target stack: TypeScript, `ecash-lib`, Chronik. Assumes Avalanche pre-consensus (live on mainnet since 2025-11-15, sub-3-second finality, finalized transactions are not double-spendable).

---

## 1. Motivation and prior art

The hard constraint UML solves is the same one every agent memory system fights: a fixed context window fills, and once full, older information silently disappears (MemGPT, Packer et al. 2023, arXiv:2310.08560). Naively growing context is not a fix. It delays the problem while raising cost and latency, and long-context models utilize the extra tokens poorly (Mem0, Chhikara et al. 2025, arXiv:2504.19413).

UML borrows three settled ideas and maps them onto UTXO primitives.

1. **Hierarchical paging.** MemGPT treats the context window like RAM and an external store like disk, paging content in and out under explicit operations. Letta's production form splits this into core, recall, and archival tiers. UML reproduces this three-tier hierarchy directly (Section 3).

2. **Atomic memory operations.** The survey "Rethinking Memory in LLM-based Agents" (arXiv:2505.00675) decomposes memory into six operations: consolidation, updating, indexing, forgetting, retrieval, and compression. UML implements each as a concrete op (Section 6), and treats forgetting as demotion out of context rather than destruction, which is both cheaper and a better fit for the human-memory analogy.

3. **Scored eviction.** Generative Agents (Park et al. 2023, arXiv:2304.03442) retrieve by a weighted sum of recency, importance, and relevance. UML uses the same triad as its default eviction score, computed entirely off-chain (Section 7).

Two findings shape the efficiency and safety posture. Mem0 reports roughly 90 percent token savings and 91 percent lower p95 latency over full-context baselines on LoCoMo, which is the bar a memory layer has to beat to be worth running. And the security literature now documents memory poisoning as a live attack class: query-injection, trajectory poisoning, and contamination that spreads through shared memory stores ("A Survey on the Security of Long-Term Memory in LLM Agents", arXiv:2604.16548). UML cannot stop a poisoned write, but it makes every write tamper-evident, ordered, and non-repudiable, which is the realistic security goal (Section 9).

---

## 2. Design principles (the "brutal" part)

These are non-negotiable. Every later decision derives from them.

**P1. O(1) consensus state.** The memory footprint inside the quine's carried state is a fixed-size header (Section 4), constant whether the agent holds ten memories or ten million. This is the headline property. Memory count never touches the carried-state budget.

**P2. One transaction per generation.** Memory operations ride inside the same transaction as the quine step, packed via eMPP (eCash Multi-Pushdata Protocol, the same mechanism ALP uses). There are no separate memory-write transactions.

**P3. Content off-chain, commitments on-chain.** Cell bodies live in a content-addressed store. Only 32-byte hashes reach consensus. This is the single largest efficiency lever and keeps every transaction small.

**P4. The covenant verifies structure, not content.** Script enforces self-replication, a monotonic counter, and an optional capacity bound. It does not verify Merkle or accumulator proofs, which would blow the 1,650-byte unlocking-script limit. Heavy verification is deferred to replay, where anyone can recompute every root from the op log and confirm the signed headers never lied (Section 8).

**P5. Cheapest commitment that supports the required operations.** The bounded core set uses a flat hash (recompute is trivial at small K). The unbounded archive uses a one-hash-per-eviction chain, with a Merkle Mountain Range upgrade path reserved for when third-party inclusion proofs are actually needed (Section 5).

---

## 3. Tier model

Three tiers, mapping MemGPT's RAM/disk hierarchy onto UTXO state.

| Tier | Analogy | Lives as | Committed by | Cost to read |
|------|---------|----------|--------------|--------------|
| Core | RAM, in-context | the bounded working set of at most K cells, loaded into the prompt every generation | `core_root` in the header | free, it is already in state |
| Recall | warm | live UTXOs not currently in core | not committed (live set is queryable) | cheap, one Chronik UTXO query |
| Archive | disk, external context | evicted cells, no longer live UTXOs, content preserved in the op log of the transaction that evicted them | `archive_root` in the header | replay, or an off-chain index |

Core is capacity-bounded, which is what guarantees the prompt never grows without limit. Eviction is demotion across tiers, terminating in archive. Because the chain is immutable, archived content is never destroyed, only moved out of context, and is recoverable by retrieval (Section 6, PROMOTE).

---

## 4. Data structures

### 4.1 MemoryCell (off-chain, content-addressed)

```
cell = {
  v:        u8        # schema version
  cell_id:  bytes16   # stable identity, assigned once at ADD, survives updates
  kind:     u8        # 0 episodic, 1 semantic, 2 procedural  (survey taxonomy)
  born_gen: u32       # generation created
  last_gen: u32       # generation last touched      -> recency signal
  score:    u16       # importance, 0..65535         -> importance signal
  body_ref: bytes32   # hash or CID of the actual content blob (off-chain)
}

cell_hash = SHA256(canonical_cbor(cell))   # version hash of this cell
```

Two-level addressing. `cell_id` is the durable handle. `cell_hash` is the hash of the current version (changes on every update). The body is a third hop behind `body_ref`. Only `cell_hash` and `cell_id` ever reach consensus, and only inside roots.

### 4.2 MemoryHeader (in carried state, fixed size)

```
MemoryHeader  (fixed, ~76 bytes)
  magic:          u16      # "UML" + schema version          2
  gen:            u32      # generation, monotonic            4   (shared with the quine counter)
  core_count:     u8       # cells currently in core, <= K    1
  core_root:      bytes32  # commitment over the core set    32
  archive_count:  u32      # total cells ever archived        4
  archive_root:   bytes32  # accumulator over the archive    32
  flags:          u8       # policy and upgrade flags          1
```

This 76-byte struct is the entire memory state in consensus, forever, regardless of total memory volume. That is P1 made concrete.

---

## 5. Commitments

### 5.1 core_root (bounded set, flat hash)

```
core_root = SHA256( concat( sort_asc( [ cell_id_i || cell_hash_i  for i in core ] ) ) )
```

Sorted by `cell_id` so the commitment is order-independent (set semantics). With K small (default 32, see Section 10), recomputing on every add, update, or evict is O(K) and negligible. A Merkle tree would be premature optimization at this K. If K ever needs to be large, switch core_root to a sorted Merkle tree and nothing else changes.

### 5.2 archive_root (unbounded log, hash chain)

```
archive_root_0     = 0x00 * 32
archive_root_{n+1} = SHA256( archive_root_n || evicted_cell_hash || gen_le_u32 )
```

One SHA-256 per eviction. O(1) update, O(1) state. Tamper-evident: any replay recomputes the chain and compares against the on-chain signed root, and a mismatch localizes the corruption to a single generation.

Limitation, stated honestly. A plain hash chain cannot prove a specific old cell is in the archive without replaying from genesis (or keeping an off-chain index). When you need to hand a third party an inclusion proof for one archived memory without a full replay, set `flags.MMR` and switch the accumulator to a Merkle Mountain Range (append O(log n), root O(1), inclusion proof O(log n)). Until then, the chain is leaner.

---

## 6. Operations

Per generation the agent emits an `OpBatch` into the transaction's eMPP payload. Each op maps to one of the six survey operations. Consensus never parses the batch. It only checks the invariant that results from it (Section 8).

```
OpBatch = [ Op, ... ]

ADD(cell_id, cell_hash)
  encoding / "updating". Insert into core.
  If core_count == K, the batch MUST also contain an EVICT or CONSOLIDATE
  that brings core back within budget. The capacity invariant is on the
  resulting state, not on op order.

TOUCH(cell_id, cell_hash_new)
  "indexing" / reinforcement. Bump last_gen and score, producing a new version.
  Same cell_id, new cell_hash. core_root recomputes.

EVICT(cell_id, cell_hash)
  "forgetting". Remove from core. Append cell_hash to the archive
  (archive_root advances, archive_count += 1). If the cell held a dedicated
  recall-tier UTXO, that UTXO is spent in this same transaction.

CONSOLIDATE([cell_hash, ...] -> summary_cell)
  "consolidation" + "compression". Replace M core cells with 1 summary.
  The M originals are EVICTed to archive, the summary is ADDed to core.
  Net core_count change = 1 - M.

PROMOTE(cell_id) -> ADD
  "retrieval". Bring an archived or recall cell back into core. Resolves to
  an ADD whose body_ref points at the recovered content. Read path only,
  no archive mutation.
```

A caution carried from the literature, encoded as a default guardrail in Section 7: consolidation that summarizes without deduplication causes catastrophic forgetting, where a summary silently overwrites earlier memories that are still relevant (agent memory survey, arXiv:2512.13564). Naive summarization pipelines lose on the order of 20 percent of encoded facts in practice. Treat CONSOLIDATE as lossy and gate it.

---

## 7. Eviction policy (off-chain, recommended default)

Policy is not hard-coded in the covenant. The chain enforces the budget. The agent chooses what to evict. The default is the Generative Agents triad.

```
keep_score(cell, now_gen, query) =
      w_r * recency(now_gen - cell.last_gen)      # exponential decay
    + w_i * importance(cell.score / 65535)        # LLM-assigned at write time
    + w_l * relevance(cosine(embed(body), embed(query)))   # query-conditioned
```

When an ADD would push `core_count` above K, evict the lowest `keep_score`, or CONSOLIDATE the lowest-M if and only if they form a tight topical cluster (cosine above a merge threshold), which is the deduplication gate that prevents catastrophic forgetting.

Defaults: `w_r, w_i, w_l = 0.4, 0.3, 0.3`. Consolidation cadence: every 50 to 200 generations, or on core saturation, whichever comes first (the practitioner-reported range). All embeddings and relevance computation live off-chain. Only the resulting set of `(cell_id, cell_hash)` pairs reaches the header.

---

## 8. Cryptographic tie to the quine covenant

This is the load-bearing section.

### 8.1 The binding

Let the quine's full carried state be

```
S = QuineState || MemoryHeader
```

a contiguous blob the quine commits to every generation as part of its self-replication. UML requires exactly one thing from the quine: that `MemoryHeader` is a contiguous, covered field of `S`. Given that, the quine's existing authorization signature over `S'` (the next state) already covers the memory roots. No separate memory signature exists, and none is needed.

Two properties follow, and they are the whole point:

- You cannot advance the agent's generation without committing a memory root, because the root is inside the state the quine must sign to reproduce itself.
- You cannot rewrite a memory root without producing a new generation, which means a new signature and a new transaction that Avalanche finalizes within seconds and that cannot be reorged.

Memory mutation and cognition are therefore the same event, authorized by the same key, ordered by the same consensus.

### 8.2 Enforcement tiers (pick your budget)

eCash has no native introspection opcodes, so the quine implements self-replication with the OP_CHECKSIG plus OP_CHECKDATASIG preimage technique, which already consumes most of the unlocking-script budget. UML therefore adds as close to zero Script as possible.

**Tier 0, always on, near-zero marginal Script cost. Commitment.**
`MemoryHeader` sits inside `S'`, covered by the signature the quine already produces. Result: every memory root is consensus-anchored, ordered, immutable, and Avalanche-final within seconds. Tampering is detectable by replay. This is the irreducible tie and it costs nothing beyond what the quine already pays.

**Tier 1, optional, roughly 10 to 20 bytes of ops. Capacity and monotonicity.**
Add Script that extracts `gen` and `core_count` from the committed state and asserts `gen' == gen + 1` and `core_count' <= K`. These are integer comparisons, trivial since the 2025-11-15 upgrade enabled 64-bit integers in Script. This buys an on-chain guarantee that the working set never exceeds budget, without anyone having to replay. Recommended on. The cost is small and the guarantee is exactly the "context never overflows" property the whole layer exists to provide.

**Tier 2, not recommended. Root recomputation in Script.**
Verifying `core_root' == SHA256(sorted core)` on-chain is possible with OP_CAT but exceeds the byte budget for any useful K. Do not do this. Replay covers it for free.

### 8.3 What the quine spec must expose

So this drops in cleanly when the quine is built:

1. `S` layout with `MemoryHeader` as a contiguous tail field.
2. The commitment mechanism for `S'` (whether `S'` is committed via a state push in the next redeem script or via an OP_RETURN the covenant binds). UML is agnostic, it requires only that the commitment covers `MemoryHeader`.
3. A hook point in the covenant where the Tier 1 predicate fragment can be inserted.

---

## 9. Integrity and threat model

Memory poisoning is a documented, current attack class: query-only injection (Dong et al. 2025), environment-injected trajectory poisoning (Zou et al. 2026), and contamination that propagates through shared memory stores in multi-agent settings (arXiv:2604.16548). UML's anchoring gives properties that vector-database memory layers structurally lack.

- **Tamper-evidence.** Every root is signed and immutable. You cannot silently rewrite a past memory. A typical vector store can be edited with no trace, which is precisely the surface progressive-corruption attacks exploit.
- **Attributable, ordered writes.** Every mutation is a signed, timestamped, Avalanche-final transaction by the pinned key. Per-memory provenance is free.
- **Fork resolution.** An attacker trying to rewrite history double-spends the quine UTXO, which is exactly the conflict Avalanche pre-consensus resolves. The canonical memory line is the finalized one.

Boundary, stated plainly. UML does not prevent a poisoned write. A compromised agent can sign a bad memory, and the chain will faithfully record it. What UML guarantees is that the bad memory is auditable, attributable, and non-repudiable, and that it cannot be retroactively hidden. Detection and write-time filtering remain an off-chain responsibility.

---

## 10. Transaction layout

One transaction per generation.

```
Inputs
  [0] current quine UTXO            (carries old state S, satisfied by the agent signature)
  [1..] recall-tier cell UTXOs being evicted this generation   (optional)

Outputs
  [0] next quine UTXO               (same genome, new state S', dust + carry)
  [1] OP_RETURN / eMPP payload:
        UML_MAGIC
        OpBatch                     (the memory ops, content by hash)
        commitment to S'            (per the quine commitment scheme)
```

The authorizing signature is in input [0]'s unlocking script and covers `S'`, which contains `MemoryHeader`, which contains the roots. That is the tie, expressed in bytes.

---

## 11. Replay and retrieval

- Subscribe Chronik to the quine's script. Each generation transaction yields the OpBatch, the committed `S'`, and the signature, pushed in real time over WebSocket.
- **Reconstruct memory at generation G.** Start from the genesis header, apply OpBatches 0 through G, recomputing `core_root` and `archive_root` at each step, and compare against the on-chain signed headers. Any mismatch flags tampering or a bug, localized to one generation. Replay is O(total ops) once, then incremental.
- **Retrieve a cell.** From `cell_hash`, fetch the cell struct and body from the off-chain store, verify the SHA-256 matches. For archived cells, the EVICT record in some generation's OpBatch proves the archival and the generation it happened at.

---

## 12. Parameters (defaults)

| Parameter | Default | Notes |
|-----------|---------|-------|
| K, core capacity | 32 cells | tune to context budget |
| Cell body | off-chain, content-addressed | sha256 or blake3 |
| On-chain footprint per cell | 0 bytes in state | 32 bytes per op record when touched |
| Archive accumulator | hash chain | switch to MMR via `flags.MMR` when inclusion proofs are needed |
| Consolidation cadence | every 50 to 200 gens, or on saturation | practitioner range |
| Scoring weights w_r, w_i, w_l | 0.4, 0.3, 0.3 | recency, importance, relevance |
| Tier 1 capacity enforcement | on | cheap, recommended |

---

## 13. Open decisions

1. **Body store.** IPFS, your own blob store, or inline in OP_RETURN. Inline only for bodies under roughly 100 bytes, accepting the on-chain cost.
2. **Typed cells via ALP, or plain UTXO plus OP_RETURN log.** ALP gives typed, transferable memory cells and multi-cell operations per transaction, at the cost of token-protocol overhead and a token-lifetime caveat worth verifying before relying on tokens for long-lived state. For a pure memory layer, plain UTXO plus an OP_RETURN op-log is leaner. Use ALP only if memories should be first-class transferable tokens.
3. **MMR now or later.** Ship the hash chain. Add the MMR the first time a third party needs an inclusion proof without replay.
4. **Where S' is committed.** State-push in the next redeem script versus OP_RETURN binding. Decide jointly with the quine spec, since it changes the self-replication check.

---

## References

- Packer, C., Fang, V., Patil, S. G., Lin, K., Wooders, S., Gonzalez, J. E. (2023). MemGPT: Towards LLMs as Operating Systems. arXiv:2310.08560.
- Chhikara, P., et al. (2025). Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory. arXiv:2504.19413 (ECAI 2025).
- Rethinking Memory in LLM-based Agents: Representations, Operations, and Emerging Topics. (2025). arXiv:2505.00675. Source of the six-operation decomposition.
- Park, J. S., et al. (2023). Generative Agents: Interactive Simulacra of Human Behavior. arXiv:2304.03442. Source of the recency, importance, relevance retrieval triad.
- Xu, W., Liang, Z., Mei, K., Gao, H., Tan, J., Zhang, Y. (2025). A-MEM: Agentic Memory for LLM Agents. arXiv:2502. Self-organizing, link-forming memory.
- Episodic Memory is the Missing Piece for Long-Term LLM Agents. (2025). arXiv:2502.06975. Five properties of episodic memory.
- A Survey on the Security of Long-Term Memory in LLM Agents: Toward Mnemonic Sovereignty. (2026). arXiv:2604.16548. Poisoning and contamination threat model.
- Agent memory survey. (2025). arXiv:2512.13564. Consolidation pathways and catastrophic-forgetting risk.
- Benchmarks for evaluation: LoCoMo (long conversational memory), LongMemEval, BEAM (1M and 10M token scales).