# Layer 2: Tool Handlers

Each handler lives in `src/tools/` and receives injected dependencies (storage, embedder, linker).

---

## knowledge_store (`store.ts`, 96 lines)

**Purpose**: Store a new knowledge chunk with embedding and auto-linking.

**Parameters**: `content` (string, max 5000), `metadata` (ChunkMetadata)

**Flow**:
1. Embed content via Ollama
2. Semantic dedup: `vectorSearchUnfiltered(embedding, 1)` — if top hit similarity >= threshold (default 0.95), return existing ID with `duplicate_of`, `similarity`, `existing_summary`
3. Create chunk in KuzuDB with UUID
5. For each `code_ref` in metadata:
   - Create CodeEntity node (embed `name + entity_type + file_path`)
   - Create Chunk→CodeEntity relationship (IMPLEMENTED_BY, TESTED_BY, or DEMONSTRATED_IN)
6. Run `linker.autoLink()` (vector similarity + suggested_relations)
7. Return `{ id, auto_links[], warnings[] }`

**Code ref relation mapping** (local to store.ts):

| Input relation | DB table |
|---|---|
| `implemented_by` | `IMPLEMENTED_BY` |
| `tested_by` | `TESTED_BY` |
| `demonstrated_in` | `DEMONSTRATED_IN` |

Other relation values (depends_on, implements, injects) are accepted in the schema but not mapped to Chunk→CodeEntity tables — they're intended for CodeEntity→CodeEntity relationships.

**Result type**: `StoreResult` — `{ id, auto_links: AutoLink[], warnings: string[], duplicate_of?: string, similarity?: number, existing_summary?: string }`

---

## knowledge_query (`query.ts`, 10 lines)

**Purpose**: Search the knowledge base.

**Parameters**: `query` (string), optional `filters` (QueryFilters)

**Flow**: Passthrough to `retriever.search()`. See [engine.md — Retriever](engine.md#retriever-engineretrieverjs) for the full pipeline.

**Result type**: `QueryResult` — `{ chunks: QueryChunk[], total: number }`

---

## knowledge_evolve (`evolve.ts`, 78 lines)

**Purpose**: Update a chunk with version tracking and archival.

**Parameters**: `id`, `new_content` (max 5000), optional `new_metadata`, `reason`

**Flow**:
1. Fetch existing chunk — throw if not found
2. Create archive chunk:
   - ID: `archive-{uuid8}`
   - Summary: `[ARCHIVED v{N}] {original summary}`
   - Importance: forced to `low`
   - Tags: appends `archived`
   - Same embedding (no re-embed of old content)
3. Create SUPERSEDES edge: `current → archive` with `reason` property
4. Re-embed new content
5. Update chunk (delete + re-create if embedding changed — see [storage.md — Vector-Indexed Column Workaround](storage.md#vector-indexed-column-workaround))
6. Version bump: `version + 1`
7. Run `linker.relinkChunk()` with new embedding
8. Return `{ id, version, reason, superseded_id }`

**Result type**: `EvolveResult` — `{ id, version, reason, superseded_id }`

---

## knowledge_link (`link.ts`, 33 lines)

**Purpose**: Manually create a relationship between two chunks.

**Parameters**: `source_id`, `target_id`, `relation` (relates_to | depends_on | contradicts | supersedes)

**Flow**:
1. Validate relation type against `RELATION_TABLE_MAP`
2. Verify source chunk exists
3. Verify target chunk exists
4. Create relationship in KuzuDB
5. Return `{ created: true, source_id, target_id, relation }`

**Result type**: `LinkResult` — `{ created, source_id, target_id, relation }`

---

## knowledge_link_code (`link-code.ts`, 75 lines)

**Purpose**: Link a knowledge chunk to code entities.

**Parameters**: `chunk_id`, `code_entities[]` (CodeRef)

**Flow**:
1. Verify chunk exists
2. For each code entity:
   - Generate ID: `code-{uuid8}`
   - Embed: `name + entity_type + file_path`
   - Create CodeEntity node
   - Look up relation in `CODE_RELATION_TABLE_MAP`
   - Create Chunk→CodeEntity relationship with optional description
3. Return `{ chunk_id, linked_entities[] }`

---

## knowledge_list (`list.ts`, 40 lines)

**Purpose**: Browse chunks with optional filters. Returns summary view (no content or embeddings).

**Parameters**: optional `filters` (domain, category, importance, tags, source), `limit` (default 50)

**Flow**:
1. Pass filters to `storage.listChunks()`
2. Map results to summary view: id, summary, domain, category, importance, source, version, updated_at, tags
3. Return `{ chunks[], total }`

---

## knowledge_delete (`delete.ts`, 16 lines)

**Purpose**: Delete a chunk and all its relationships.

**Parameters**: `id`

**Flow**:
1. Verify chunk exists — throw if not found
2. `storage.deleteChunk()` (uses `DETACH DELETE` to remove all relationships)
3. Return `{ deleted: true, id }`

---

## knowledge_ingest (`ingest.ts`, 19 lines)

**Purpose**: Read a file so Claude can analyze and store it as knowledge chunks.

**Parameters**: `path` (absolute file path)

**Flow**:
1. Read file with `fs/promises.readFile()`
2. If > 50,000 chars, append chunking warning
3. Return file content, path, and size to Claude
4. Claude then decides how to chunk and calls `knowledge_store()` N times

---

## Error Handling

- Chunk not found: throw `Error("Chunk not found: {id}")`
- Invalid relation: throw `Error("Invalid relation type: ...")`
- Code ref failures: caught per-ref, logged, skipped (non-fatal)

---

## Result Type Reference

| Interface | Purpose |
|-----------|---------|
| `StoreResult` | Store response: `{ id, auto_links[], warnings[] }` |
| `AutoLink` | Auto-created link: target_id, relation, score |
| `QueryResult` | Search response: `{ chunks: QueryChunk[], total }` |
| `QueryChunk` | Enriched chunk with score and code_links |
| `CodeLink` | Simplified code entity link: name, type, path, relation, description |
| `LinkResult` | Link response: created, source_id, target_id, relation |
| `EvolveResult` | Evolve response: id, version, reason, superseded_id |

All interfaces defined in `src/types.ts`.
