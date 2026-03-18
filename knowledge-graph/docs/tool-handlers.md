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

**Purpose**: Delete a chunk and all its relationships.

**Parameters**: `id`

**Flow**:
1. Verify chunk exists — throw if not found
2. `storage.deleteChunk()` (uses `DETACH DELETE` to remove all relationships)
3. Return `{ deleted: true, id }`

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
| `DeleteResult` | Delete response: { deleted, id } |

All interfaces defined in `src/types.ts`.
