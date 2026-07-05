# Layer 4: Storage

**Files**: `src/storage/interface.ts`, `src/storage/kuzu.ts`, `src/storage/surreal.ts`

---

## Storage Abstraction

All storage access goes through the `IStorage` interface (`storage/interface.ts`). The `createStorage(backend, dbPath)` factory dynamically imports the selected backend. Tool handlers and engine components are backend-agnostic.

### Available Backends

| Backend | Package | Connection | Default? |
|---------|---------|------------|----------|
| KuzuDB | `kuzu` | File-based embedded | **Yes** |
| SurrealDB | `surrealdb` + `@surrealdb/node` | `surrealkv://` embedded | No (opt-in via `--storage surreal`) |

---

## KuzuDB (`storage/kuzu.ts`)

Embedded graph database with vector extension. No external server needed — database files live in the configured `DB_PATH` directory.

---

## Schema

### Chunk Node Table (21 columns)

15 columns in CREATE TABLE + 6 via ALTER TABLE migrations.

| Column | Type | Description | Source |
|--------|------|-------------|--------|
| `id` | STRING (PK) | UUID | CREATE |
| `content` | STRING | Full knowledge text (Zod hard limit 5000 chars; per-category size warnings in `store.ts`) | CREATE |
| `summary` | STRING | 1-sentence description (max 200 chars) | CREATE |
| `embedding` | DOUBLE[1024] | bge-m3 vector embedding | CREATE |
| `source` | STRING | Origin file path or identifier | CREATE |
| `category` | STRING | fact, rule, insight, question, workflow, decision | CREATE |
| `domain` | STRING | Topic area (e.g., "dependency-injection") | CREATE |
| `importance` | STRING | critical, high, medium, low | CREATE |
| `layer` | STRING | core-knowledge, learning, procedural, or custom (DEFAULT 'core-knowledge') | CREATE |
| `keywords` | STRING[] | Search terms | CREATE |
| `entities` | STRING[] | Named things (class names, tools) | CREATE |
| `tags` | STRING[] | Free-form tags | CREATE |
| `created_at` | STRING | ISO 8601 timestamp | CREATE |
| `updated_at` | STRING | ISO 8601 timestamp | CREATE |
| `version` | INT64 | Version counter (starts at 1) | CREATE |
| `confidence` | DOUBLE | Trust score 0.0–1.0 (DEFAULT 0.5) | ALTER |
| `validation_count` | INT64 | Times confirmed (DEFAULT 0) | ALTER |
| `refutation_count` | INT64 | Times refuted (DEFAULT 0) | ALTER |
| `last_validated_at` | STRING | ISO timestamp of last validation (DEFAULT '') | ALTER |
| `lifecycle` | STRING | hypothesis, validated, promoted, canonical, refuted, active (DEFAULT 'active') | ALTER |
| `access_count` | INT64 | Times retrieved via query (DEFAULT 0) | ALTER |

### Content Size Warning Targets

The `store` handler emits warnings when content exceeds category-specific size targets. These are advisory only -- the Zod hard limit of 5000 chars (in `client.ts`) is the enforced maximum.

| Category | Warning Target |
|----------|---------------|
| `fact` | 500 chars |
| `rule` | 800 chars |
| `insight` | 600 chars |
| `question` | 400 chars |
| `workflow` | 800 chars |
| `decision` | 800 chars |

### 15 Relationship Tables (Chunk → Chunk)

| Table | Properties | Semantics |
|-------|-----------|-----------|
| `RELATES_TO` | `auto_created STRING` | General semantic relationship |
| `DEPENDS_ON` | `auto_created STRING` (via migration) | Source requires target |
| `CONTRADICTS` | `auto_created STRING` (via migration) | Source conflicts with target |
| `SUPERSEDES` | `reason STRING` | Source is newer version of target |
| `TRIGGERS` | `description STRING, auto_created STRING` | Source triggers target |
| `REQUIRES` | `description STRING, auto_created STRING` | Source requires target |
| `PRODUCES` | `description STRING, auto_created STRING` | Source produces target |
| `IS_PART_OF` | `description STRING, auto_created STRING` | Source is part of target |
| `CONSTRAINS` | `description STRING, auto_created STRING` | Source constrains target |
| `PRECEDES` | `description STRING, auto_created STRING` | Source precedes target |
| `TRANSITIONS_TO` | `description STRING, auto_created STRING` | Source transitions to target |
| `GOVERNED_BY` | `description STRING, auto_created STRING` | Source is governed by target |

### SessionState Node Table (14 columns)

A separate node table for **volatile working memory** (session context, plans, tasks, compaction events). It holds NO embedding and has NO vector index — updates use cheap in-place `SET` (KuzuDB) / direct `UPDATE` (SurrealDB) instead of the delete+recreate workaround `Chunk` needs. It is local-only and is never included in the sync/export path.

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING (PK) | UUID |
| `session_id` | STRING (DEFAULT '') | Client-minted per-process session id |
| `project_id` | STRING (DEFAULT '') | Owning project |
| `artifact_type` | STRING | `active_context`, `task`, `event`, or `plan` |
| `status` | STRING (DEFAULT '') | Artifact-specific status (e.g. task: pending/in_progress/blocked/done/deferred; plan: active/superseded) |
| `title` | STRING (DEFAULT '') | Focus statement / task title / plan title |
| `body` | STRING (DEFAULT '') | Free text or JSON payload (e.g. `{next_step, note}`) |
| `refs` | STRING[] | File paths / chunk ids / `blocked_by:<taskId>` refs |
| `version` | INT64 (DEFAULT 1) | Version counter (plans immutable-versioned; tasks CAS via `expected_version`) |
| `pinned` | BOOLEAN (DEFAULT false) | Exempt from compaction |
| `active` | BOOLEAN (DEFAULT true) | Soft-evict flag (anti-orphaning) |
| `created_at` | STRING | ISO 8601 timestamp |
| `updated_at` | STRING | ISO 8601 timestamp |
| `last_touched_at` | STRING (DEFAULT '') | For anti-orphaning age checks |

KuzuDB: `CREATE NODE TABLE SessionState (...)`. SurrealDB: SCHEMAFULL `session_state` table defined via `DEFINE TABLE/FIELD ... IF NOT EXISTS`. CRUD: `createSessionState`, `getSessionState`, `updateSessionState` (in-place SET), `listSessionState` (filtered by session/project/artifact_type/status/active), `deleteSessionState`.

---

## Graph Schema Diagram

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
          RELATES_TO│   DEPENDS_ON   CONTRADICTS   SUPERSEDES     │
        (auto_created)  TRIGGERS     REQUIRES      (reason)       │
                    │   PRODUCES     IS_PART_OF    CONSTRAINS     │
                    │   PRECEDES     TRANSITIONS_TO GOVERNED_BY   │
                    │                                              │
                 ┌──┴──┐                                    ┌──┴──┐
                 │Chunk│────────────────────────────────────│Chunk│
                 └─────┘                                    └─────┘
```

### Query Examples

**"What knowledge relates to this chunk?"**
```cypher
MATCH (c:Chunk {id: $id})-[:RELATES_TO|DEPENDS_ON*1..2]-(related:Chunk)
RETURN DISTINCT related.id, related.summary, related.domain
```

Note: Simplified example — the actual `getRelatedChunks()` implementation traverses all 15 relation types (see full query at line 147).

---

## Vector Index

```cypher
CALL CREATE_VECTOR_INDEX('Chunk', 'chunk_embedding_idx', 'embedding', metric := 'cosine')
```

HNSW (Hierarchical Navigable Small World) index on the Chunk embedding column. Cosine metric. Enables efficient approximate nearest neighbor search.

### Vector-Indexed Column Workaround

KuzuDB does not allow `SET` on vector-indexed columns. When a chunk's embedding changes (e.g., during evolve):

1. Save all existing relationships via `saveChunkRelations()`
2. `DETACH DELETE` the old node
3. `CREATE` a new node with merged data
4. Restore all saved relationships via `restoreChunkRelations()`

All relationships (both auto-created and manual) are preserved across this cycle. The `evolve` handler then runs `relinkChunk()` to refresh auto-created links with the new embedding.

---

## CRUD Operations

**createChunk**: Accepts the normal chunk payload plus optional `created_at` and `updated_at` overrides. If omitted, timestamps are auto-generated. This lets Kuzu's delete-and-recreate evolve path preserve the original `created_at`. Parameterized `CREATE` with `cast($embedding, 'DOUBLE[1024]')` for the vector column.

**getChunk**: `MATCH (c:Chunk) WHERE c.id = $id RETURN c.*`

**updateChunk**: If embedding changes → delete + re-create. Otherwise → `MATCH ... SET` for changed fields only.

**deleteChunk**: `MATCH (c:Chunk) WHERE c.id = $id DETACH DELETE c` — removes node and all relationships.

**listChunks**: Dynamic WHERE clause built from filters. Parameterized query with LIMIT. Note: although `listChunks()` supports `min_confidence` in its WHERE clause (filtering on raw confidence), the `list` tool handler (`list.ts`) strips `min_confidence` from filters before calling storage, then applies it post-query against effective (decayed) confidence instead.

**vectorSearchUnfiltered**: Used for semantic deduplication. Raw vector search with no metadata filters — returns top-K nearest chunks by cosine distance.

---

## Search Operations

**vectorSearch**: `CALL QUERY_VECTOR_INDEX(...)` with post-filtering by domain/category/importance/layer/tags/min_confidence/lifecycle/since. Returns chunks sorted by cosine distance. Note: The embedding column is not selected in vectorSearch results (for performance). Returned chunks have an empty embedding array (`flatRowToChunk` defaults to `[]`).

**getRelatedChunks**: Variable-length path traversal across all 12 Chunk→Chunk relationship types. Configurable depth (function signature default 2, but the retriever always calls with depth 1).

```cypher
MATCH (c:Chunk {id: $id})-[r:RELATES_TO|DEPENDS_ON|CONTRADICTS|SUPERSEDES|TRIGGERS|REQUIRES|PRODUCES|IS_PART_OF|CONSTRAINS|PRECEDES|TRANSITIONS_TO|GOVERNED_BY*1..N]-(related:Chunk)
RETURN DISTINCT related.*
```

**findChunksByDomain**: `WHERE c.domain = $domain`. Exact match only. Used by the linker for suggested relation matching.

Note: Hierarchical domain matching (`domain STARTS WITH $domainPrefix`) is available in `listChunks()` and `vectorSearch()` post-filters, but NOT in `findChunksByDomain()`.

**findChunksByKeyword**: Lowercases the search keyword, then runs `WHERE c.content CONTAINS $keyword OR c.summary CONTAINS $keyword`. Note: KuzuDB `CONTAINS` is case-sensitive, and content/summary are stored as-is (not lowered). The lowercased query will only match lowercase occurrences in stored text — mixed-case content (e.g., "GetIt") will NOT match a lowercased query (e.g., "getit").

---

## Semantic Deduplication

Before every store operation, the embedding is computed and a `vectorSearchUnfiltered(embedding, 1)` is run. If the nearest existing chunk has cosine similarity >= the configured threshold (default 0.88), the store returns the existing chunk ID along with `duplicate_of`, `similarity`, and `existing_summary` fields. This catches reformatted, paraphrased, or slightly edited content that SHA256 hashing would miss.

---

## Row Mapping

Two helpers handle KuzuDB row format differences:

- **rowToChunk**: Maps `c.*` or `related.*` prefixed columns (from MATCH queries)
- **flatRowToChunk**: Maps unprefixed column aliases (from QUERY_VECTOR_INDEX)

---

## Idempotent Schema Creation

The `run()` helper catches "already exists" errors silently. This makes `initialize()` safe to call on an existing database — it won't fail on pre-existing tables or indices.

---

## Relation Table Mappings

`RELATION_TABLE_MAP` in `src/types.ts` converts relation strings to KuzuDB table names (15 Chunk → Chunk relations):

| Key | Table |
|-----|-------|
| `relates_to` | `RELATES_TO` |
| `depends_on` | `DEPENDS_ON` |
| `contradicts` | `CONTRADICTS` |
| `supersedes` | `SUPERSEDES` |
| `triggers` | `TRIGGERS` |
| `requires` | `REQUIRES` |
| `produces` | `PRODUCES` |
| `is_part_of` | `IS_PART_OF` |
| `constrains` | `CONSTRAINS` |
| `precedes` | `PRECEDES` |
| `transitions_to` | `TRANSITIONS_TO` |
| `governed_by` | `GOVERNED_BY` |

---

## Type System Reference

### Stored Types

| Interface | Purpose |
|-----------|---------|
| `StoredChunk` | Full chunk as stored in the database (fields including embedding, version, learning fields) |

### Enums (Type Aliases)

| Type | Values |
|------|--------|
| `ChunkCategory` | fact, rule, insight, question, workflow, decision |
| `SessionArtifactType` | active_context, task, event, plan |
| `Importance` | critical, high, medium, low |
| `KnowledgeRelation` | 15 relation types (see RELATION_TABLE_MAP above) |

### Constants

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `EMBEDDING_DIMENSIONS` | 1024 | `types.ts` | bge-m3 output dimensions (used in KuzuDB `DOUBLE[N]` columns) |

Changing `EMBEDDING_DIMENSIONS` requires a database migration (re-create tables with new column type).

### log() Function

```typescript
export function log(...args: unknown[]): void {
  console.error('[knowledge-graph]', ...args);
}
```

Uses `console.error` because `console.log` writes to stdout and would corrupt the JSON-RPC stdio transport.

---

## Error Handling (KuzuDB)

- "Already exists" errors: silently ignored (idempotent schema creation)
- Connection not initialized: throws immediately
- Prepare failure: throws with KuzuDB error message
- Vector index creation: wrapped in try-catch (may already exist)

---

## SurrealDB (`storage/surreal.ts`)

Embedded graph+document database using `@surrealdb/node` native bindings. No external server needed — uses `surrealkv://` protocol for file-based storage.

### Connection

```typescript
const db = new Surreal({ engines: createNodeEngines() });
await db.connect(`surrealkv://${dbPath}`);
await db.use({ namespace: 'knowledge', database: 'graph' });
```

### Schema

SCHEMAFULL `chunk` table with all 24 fields. Array fields use typed sub-fields (e.g., `keywords.*` TYPE string). Embedding field is `array<float>` with HNSW vector index (1024 dims, COSINE distance).

A second SCHEMAFULL `session_state` table mirrors the KuzuDB SessionState table (14 fields, no embedding, no vector index) — see [SessionState Node Table](#sessionstate-node-table-14-columns). Defined idempotently via `DEFINE TABLE/FIELD ... IF NOT EXISTS`; updates use direct `UPDATE`.

### Key Differences from KuzuDB

| Aspect | KuzuDB | SurrealDB |
|--------|--------|-----------|
| `updateChunk` with embedding | Delete + recreate workaround | Direct `UPDATE` — no workaround needed |
| Record IDs | Plain strings | `RecordId` objects — `extractId()` strips table prefix |
| Relation tables | UPPERCASE (e.g., `RELATES_TO`) | lowercase (e.g., `relates_to`) |
| `REQUIRES` table | `REQUIRES` | `requires_rel` (reserved word) |
| Vector search | `CALL QUERY_VECTOR_INDEX(...)` | `embedding <\|K, COSINE\|> $vec` KNN operator |
| Graph traversal | Variable-length Cypher path | Per-table outgoing+incoming queries with FETCH |
| Row mapping | `rowToChunk` + `flatRowToChunk` (prefixed columns) | Single `rowToChunk` (flat objects) |

### Relation Table Mapping

`SURREAL_REL_TABLE` maps UPPERCASE relation types to SurrealDB table names:

| Relation Type | SurrealDB Table |
|---------------|-----------------|
| `RELATES_TO` | `relates_to` |
| `DEPENDS_ON` | `depends_on` |
| `REQUIRES` | `requires_rel` |
| ... (12 more) | lowercase equivalent |

### Error Handling (SurrealDB)

- Schema uses `DEFINE ... IF NOT EXISTS` for idempotent creation
- `deleteAutoRelations` wrapped in try-catch (table may be empty)
- Empty query results return `[]` (never null)
