# Layer 2: Tool Handlers

Each handler lives in `src/tools/` and receives injected dependencies (storage, embedder, linker).

---

## knowledge_store (`store.ts`)

**Purpose**: Store a new knowledge chunk with embedding, dedup, auto-linking, and proactive surfacing.

**Parameters**: `content` (string, max 5000 Zod hard limit), `metadata` (ChunkMetadata)

**Flow**:
1. Embed content via Ollama
2. Semantic dedup: `vectorSearchUnfiltered(embedding, 1)` — if top hit similarity >= threshold (default 0.88), return existing ID with `duplicate_of`, `similarity`, `existing_content`, `existing_summary`, `action_hint`
3. Proactive surfacing: `vectorSearchUnfiltered(embedding, 5)` — find validated/canonical/promoted chunks with similarity 0.60 to < dedup threshold (default 0.88)
4. Normalize metadata (keywords, tags, entities, domain, source)
5. Infer layer from category if not provided (`inferLayer()`)
6. Set learning defaults: insights/questions get `lifecycle=hypothesis`, `confidence=0.3`; others get `lifecycle=active`, `confidence=0.5`
7. Create chunk in KuzuDB with UUID
8. Run `linker.autoLink()` (vector similarity + suggested_relations)
9. Return `{ id, auto_links[], warnings[], related_knowledge[] }`

**Result type**: `StoreResult` — `{ id, auto_links: AutoLink[], warnings: string[], duplicate_of?: string, similarity?: number, existing_content?: string, existing_summary?: string, action_hint?: string, related_knowledge?: Array<{ id, summary, confidence, lifecycle, similarity, relation_hint }> }`

---

## knowledge_query (`query.ts`)

**Purpose**: Search the knowledge base.

**Parameters**: `query` (string), optional `filters` (QueryFilters)

**Flow**: Passthrough to `retriever.search()`. See [engine.md — Retriever](engine.md#retriever-engineretrieversts) for the full pipeline.

**Result type**: `QueryResult` — `{ chunks: QueryChunk[], total: number }`

---

## knowledge_evolve (`evolve.ts`)

**Purpose**: Update a chunk with version tracking, archival, and confidence preservation.

**Parameters**: `id`, `new_content` (max 5000 Zod hard limit), optional `new_metadata`, `reason`

**Flow**:
1. Fetch existing chunk — throw if not found
2. Create archive chunk:
   - ID: `archive-{uuid8}`
   - Summary: `[ARCHIVED v{N}] {original summary}`
   - Importance: forced to `low`
   - Tags: appends `archived`
   - Same embedding (no re-embed of old content)
   - Copies all learning fields: confidence, validation_count, refutation_count, last_validated_at, lifecycle, access_count
3. Create SUPERSEDES edge: `current → archive` with `reason` property
4. Re-embed new content
5. Update chunk (delete + re-create if embedding changed — see [storage.md — Vector-Indexed Column Workaround](storage.md#vector-indexed-column-workaround))
6. Version bump: `version + 1`
7. Preserve learning fields: confidence, validation_count, refutation_count, lifecycle, last_validated_at, access_count
8. Run `linker.relinkChunk()` — deletes auto-created RELATES_TO edges (vector-similarity links). Edges from suggested_relations (no `auto_created` property) are preserved like manual links.
9. Return `{ id, version, reason, superseded_id, note }`

Note: The `note` field is always returned unconditionally with the message "Content evolved. If the meaning changed significantly, consider re-validating this chunk."

**Result type**: `EvolveResult` — `{ id, version, reason, superseded_id, note: string }`

---

## knowledge_link (`link.ts`)

**Purpose**: Manually create a relationship between two chunks.

**Parameters**: `source_id`, `target_id`, `relation` (one of 15 relation types — see `RELATION_TABLE_MAP` in `types.ts`)

**Flow**:
1. Validate relation type against `RELATION_TABLE_MAP`
2. Verify source chunk exists
3. Verify target chunk exists
4. Create relationship in KuzuDB
5. Return `{ created: true, source_id, target_id, relation }`

Note: Manual links created via `knowledge_link` do not set any edge properties (no `description`, no `auto_created`). Edge properties are only set by the auto-linker (`auto_created: 'true'` on RELATES_TO) and by `knowledge_evolve` (`reason` on SUPERSEDES).

**Result type**: `LinkResult` — `{ created, source_id, target_id, relation }`

---

## knowledge_list (`list.ts`)

**Purpose**: Browse chunks with optional filters. Returns summary view with effective confidence.

**Parameters**: optional `filters` (domain, category, importance, tags, source, layer, lifecycle, min_confidence, since), `limit` (default 50)

**Flow**:
1. Strip `min_confidence` from filters, pass remaining filters to `storage.listChunks()`
2. Compute effective confidence with temporal decay for each chunk
3. Apply `min_confidence` filter against effective (decayed) confidence
4. Map results to summary view: id, summary, domain, category, importance, layer, source, version, updated_at, tags, confidence, effective_confidence, lifecycle, validation_count, access_count, last_validated_at
5. Return `{ chunks[], total }`

---

## knowledge_delete (`delete.ts`)

**Purpose**: Delete a chunk and all its relationships. Lifecycle guard protects validated/promoted/canonical chunks.

**Parameters**: `id`, optional `reason`

**Flow**:
1. Verify chunk exists — throw if not found
2. **Lifecycle guard**: If chunk lifecycle is `validated`, `promoted`, or `canonical` and no `reason` provided — throw error: "Cannot delete {lifecycle} chunk without a reason."
3. Capture snapshot: `{ domain, category, lifecycle, confidence, summary }`
4. `storage.deleteChunk()` (uses `DETACH DELETE` to remove all relationships)
5. Return `{ deleted: true, id, snapshot, reason? }`

Note: `hypothesis`, `active`, and `refuted` chunks can be deleted without a reason (low blast radius — these are unvalidated or already discredited knowledge).

**Result type**: `DeleteResult` — `{ deleted, id, snapshot?: { domain, category, lifecycle, confidence, summary }, reason? }`

---

## knowledge_validate (`validate.ts`)

**Purpose**: Confirm or refute a knowledge chunk, driving the lifecycle state machine.

**Parameters**: `id`, `action` (`confirm` | `refute`), optional `evidence`, optional `context`

**Flow**:
1. Fetch existing chunk — throw if not found
2. If `action === 'confirm'`:
   - Compute new confidence: `min(1.0, old + boost * (1 / (1 + 0.3 * validation_count)))`
   - Increment `validation_count`
   - Update `last_validated_at` to now
   - Auto-promote hypothesis → validated if `validation_count >= 3` AND `confidence >= 0.85`
   - Revive refuted → hypothesis if `confidence >= 0.2`
3. If `action === 'refute'`:
   - Compute new confidence: `max(0.0, old - penalty * (1 + 0.1 * refutation_count))`
   - Increment `refutation_count`
   - Update `last_validated_at` to now
   - Set lifecycle to `refuted` if `confidence < 0.2`
4. Update chunk in storage
5. Return `{ id, action, confidence, validation_count, refutation_count, lifecycle, auto_promoted, promotion_details? }`

Note: The `action` field in the response returns the past tense form: `'confirmed'` or `'refuted'` (not the input values `'confirm'`/`'refute'`).

**Result type**: `ValidateResult` — `{ id, action: 'confirmed' | 'refuted', confidence, validation_count, refutation_count, lifecycle, auto_promoted: boolean, promotion_details?: { reason } }`

---

## knowledge_promote (`promote.ts`)

**Purpose**: Graduate a knowledge chunk to a higher lifecycle status.

**Parameters**: `id`, `reason`, optional `new_category`, optional `new_importance`

**Flow**:
1. Fetch existing chunk — throw if not found
2. Guard: cannot promote refuted chunks (`confidence < 0.2`)
3. Guard: cannot promote low-confidence chunks (`confidence < 0.5`)
4. Guard: cannot promote already-canonical chunks
5. Caller-side policy: Claude should verify golden evidence before calling; the handler does not inspect evidence sources itself.
6. Determine next lifecycle: hypothesis → validated → promoted → canonical. Also supports `active` → `promoted` directly.

Note: The "cannot promote refuted" guard checks confidence (< 0.2), not lifecycle. A chunk with lifecycle `refuted` but confidence >= 0.5 (partially revived via confirmations) passes all guards, but the lifecycle switch has no `refuted` case — so the lifecycle remains unchanged.
7. Guard: canonical requires `confidence >= 0.9`
8. Update lifecycle, optionally update category and importance
9. Return `{ id, previous_category, new_category, previous_lifecycle, new_lifecycle, confidence, reason }`

**Result type**: `PromoteResult` — `{ id, previous_category, new_category, previous_lifecycle, new_lifecycle, confidence, reason }`

---

## decision_record (`decision.ts`)

**Purpose**: Record a durable architectural/design decision as a `Chunk` (category `decision`, layer `core-knowledge`).

**Parameters**: `content`, `summary`, `domain`, `keywords`, optional `importance` (default `high`), optional `supersedes_id`, optional `rationale`

**Flow**:
1. Build metadata with `category='decision'`
2. Delegate to `handleStore()` with `skipDedup=true` — the 0.88 dedup check is bypassed so near-identical iterative decisions each persist as separate chunks
3. If `supersedes_id` is set, create a `SUPERSEDES` edge (new → prior) carrying `rationale`, forming a queryable decision lineage
4. Return the `StoreResult` (`{ id, auto_links[], superseded_id?, ... }`)

---

## Session-State Handlers (`state-*.ts`)

All session-state handlers read/write the `SessionState` table (volatile, no embedding). The daemon threads the calling `session_id` into each; a caller-supplied `session_id` overrides it (empty string = all project sessions).

### state_set_context / state_get_context (`state-context.ts`)

- **set**: append an `active_context` row (`title=focus`, `body={next_step, note}`, `refs`). Returns `{ id, session_id, focus, next_step, refs, created_at }`. The daemon opportunistically triggers compaction after the write when the session is far over the keep-recent window.
- **get**: list `active_context` rows (own session by default; empty session spans all), newest-first, sliced to `limit`, optional `since` filter. Returns `{ session_id, latest, trail[], total }`.

### state_save_plan / state_get_plan (`state-plan.ts`)

- **save**: clone the source `.md` into `<kgDir>/state/plans/<project>/<session>/<ts>-<slug>.md`, mint an immutable `plan` row (v1 = original), mark any prior active plan of the same title `superseded`. Returns `{ id, title, version, status, source_path, clone_path, refs[], created_at }`.
- **get**: resolve the active version by default (or a specific `version`), project-scoped. Returns `{ session_id, title, requested_version, plan, versions[], total }`.

### state_task_upsert / state_task_list (`state-task.ts`)

- **upsert**: create (no `task_id`) or update-in-place a `task` row; `status` in the status field, `note` in the JSON body, `blocked_by` encoded as `blocked_by:<id>` refs. Optional `expected_version` enforces optimistic concurrency (conflict on mismatch). Returns the task entry.
- **list**: filter `task` rows by session/status. Returns `{ session_id, status, tasks[], total }`.

### state_checkpoint / state_resume (`state-checkpoint.ts`)

- **checkpoint**: fold the session's `active_context` + active `plan` + open `task`s + recent `decision` chunks (limit 10) into `{ session_id, active_context[], open_tasks[], active_plan, recent_decisions[] }`.
- **resume**: project-scoped (works on a fresh session). Adds `active_plans[]`, `orphaned[]` (tasks untouched > 7 days), and a rendered `markdown` briefing.

### state_prune (`state-prune.ts`)

**Purpose**: anti-orphaning GC. Finds `task`/`event` rows that are active, unpinned, not done/compacted, and untouched past the cutoff (default 7 days). `mode='surface'` reports only; `mode='evict'` soft-evicts (`active=false`). Plans and pinned rows are never orphaned. Returns `{ project_id, mode, older_than_days, cutoff, orphaned[], evicted_count?, message }`.

### state_compact (`state-compact.ts`)

**Purpose**: fold old `active_context` events per session into a summary `event` snapshot, keeping the newest `keep_recent` (default 50) verbatim. Pinned rows, plans, and tasks are never compacted. Returns `{ project_id, keep_recent, compacted_count, sessions_affected, summaries[], message }`.

### state_sessions / state_projection

- **state_sessions**: served directly by the daemon from its in-memory registry (not a `tools/` handler). Returns `{ sessions: [{ session_id, connectedAt, last_seen }] }`.
- **state_projection** (`engine/projection.ts`): folds a cross-session board — per-session latest focus, union of edited files, combined open tasks — plus a `markdown` summary. Returns `ProjectionView & { markdown }`.

---

## Error Handling

- Chunk not found: throw `Error("Chunk not found: {id}")`
- Invalid relation: throw `Error("Invalid relation type: ...")`

---

## Result Type Reference

| Interface | Purpose |
|-----------|---------|
| `StoreResult` | Store response: `{ id, auto_links[], warnings[], duplicate_of?, related_knowledge? }` |
| `AutoLink` | Auto-created link: target_id, relation, score |
| `QueryResult` | Search response: `{ chunks: QueryChunk[], total }` |
| `QueryChunk` | Enriched chunk with score, confidence, lifecycle |
| `LinkResult` | Link response: created, source_id, target_id, relation |
| `EvolveResult` | Evolve response: id, version, reason, superseded_id, note |
| `ValidateResult` | Validate response: id, action, confidence, validation_count, refutation_count, lifecycle, auto_promoted |
| `PromoteResult` | Promote response: id, previous/new category, previous/new lifecycle, confidence, reason |
| `ListResult` | List response: chunks[] (summary view with effective_confidence), total |
| `DeleteResult` | Delete response: { deleted, id, snapshot?, reason? } |

All interfaces defined in `src/types.ts`.
