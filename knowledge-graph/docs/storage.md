# Layer 4: Storage

**File**: `src/storage/kuzu.ts` (585 lines)

---

## KuzuDB

Embedded graph database with vector extension. No external server needed — database files live in the configured `DB_PATH` directory.

---

## Schema

### Chunk Node Table (15 columns)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING (PK) | UUID |
| `content` | STRING | Full knowledge text (max 5000 chars) |
| `summary` | STRING | 1-sentence description (max 200 chars) |
| `embedding` | DOUBLE[1024] | bge-m3 vector embedding |
| `source` | STRING | Origin file path or identifier |
| `category` | STRING | rule, pattern, example, reference, learning, workflow, concept |
| `domain` | STRING | Topic area (e.g., "dependency-injection") |
| `importance` | STRING | critical, high, medium, low |
| `keywords` | STRING[] | Search terms |
| `entities` | STRING[] | Named things (class names, tools) |
| `tags` | STRING[] | Free-form tags |
| `created_at` | STRING | ISO 8601 timestamp |
| `updated_at` | STRING | ISO 8601 timestamp |
| `version` | INT64 | Version counter (starts at 1) |

### CodeEntity Node Table (11 columns)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING (PK) | `code-{uuid8}` |
| `name` | STRING | Entity name (class, function, file) |
| `entity_type` | STRING | E.g., "class", "method", "interface" |
| `file_path` | STRING | Absolute or relative file path |
| `line_start` | INT64 | Starting line number (0 if unknown) |
| `line_end` | INT64 | Ending line number (0 if unknown) |
| `signature` | STRING | Type signature (empty if unknown) |
| `layer` | STRING | presentation, domain, data, core, test |
| `feature` | STRING | Feature name |
| `embedding` | DOUBLE[1024] | Embedding of `name + entity_type + file_path` |
| `updated_at` | STRING | ISO 8601 timestamp |

### 13 Relationship Tables

**Chunk → Chunk (4 types)**

| Table | Properties | Semantics |
|-------|-----------|-----------|
| `RELATES_TO` | none | General semantic relationship |
| `DEPENDS_ON` | none | Source requires target |
| `CONTRADICTS` | none | Source conflicts with target |
| `SUPERSEDES` | `reason: STRING` | Source is newer version of target |

**Chunk → CodeEntity (3 types)**

| Table | Properties | Semantics |
|-------|-----------|-----------|
| `IMPLEMENTED_BY` | `description: STRING` | Knowledge implemented in this code |
| `TESTED_BY` | `description: STRING` | Knowledge tested by this code |
| `DEMONSTRATED_IN` | `description: STRING` | Knowledge demonstrated in this code |

**CodeEntity → CodeEntity (6 types)**

| Table | Properties | Semantics |
|-------|-----------|-----------|
| `DEFINED_IN` | none | Entity defined in another entity (e.g., method in class) |
| `IMPORTS` | none | Entity imports another |
| `TESTS` | none | Entity tests another |
| `CODE_DEPENDS_ON` | `via: STRING` | Code dependency (via DI, import, etc.) |
| `IMPLEMENTS` | none | Entity implements an interface |
| `INJECTS` | `registration: STRING` | DI injection relationship |

---

## Graph Schema Diagram

```
                    ┌──────────────────────────────┐
                    │                              │
          RELATES_TO│   DEPENDS_ON   CONTRADICTS   │SUPERSEDES
          ◄────────►│   ◄────────►   ◄────────►   │(reason)
                    │                              │
                 ┌──┴──┐                        ┌──┴──┐
                 │Chunk│──────────────────────── │Chunk│
                 └──┬──┘                        └─────┘
                    │
     ┌──────────────┼──────────────┐
     │              │              │
 IMPLEMENTED_BY  TESTED_BY  DEMONSTRATED_IN
 (description)  (description)  (description)
     │              │              │
     ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│ CodeEntity │ │ CodeEntity │ │ CodeEntity │
└─────┬──────┘ └────────────┘ └────────────┘
      │
      │  DEFINED_IN    IMPORTS      TESTS
      │  IMPLEMENTS    INJECTS      CODE_DEPENDS_ON
      │  (registration)  (via)
      ▼
┌────────────┐
│ CodeEntity │
└────────────┘
```

### Impact Analysis Examples

**"What code implements this knowledge?"**
```cypher
MATCH (c:Chunk {id: $id})-[:IMPLEMENTED_BY]->(e:CodeEntity)
RETURN e.name, e.file_path, e.line_start
```

**"What knowledge relates to this chunk?"**
```cypher
MATCH (c:Chunk {id: $id})-[:RELATES_TO|DEPENDS_ON*1..2]-(related:Chunk)
RETURN DISTINCT related.id, related.summary, related.domain
```

**"What other code depends on this entity?"**
```cypher
MATCH (e:CodeEntity {id: $id})<-[:CODE_DEPENDS_ON]-(dep:CodeEntity)
RETURN dep.name, dep.file_path, dep.layer
```

---

## Vector Index

```cypher
CALL CREATE_VECTOR_INDEX('Chunk', 'chunk_embedding_idx', 'embedding', metric := 'cosine')
```

HNSW (Hierarchical Navigable Small World) index on the Chunk embedding column. Cosine metric. Enables efficient approximate nearest neighbor search.

### Vector-Indexed Column Workaround

KuzuDB does not allow `SET` on vector-indexed columns. When a chunk's embedding changes (e.g., during evolve):

1. Read the full chunk
2. `DETACH DELETE` the old node (removes all relationships)
3. `CREATE` a new node with merged data

This means **relationships are lost** when embedding changes. The `evolve` handler compensates by running `relinkChunk()` after update.

---

## CRUD Operations

**createChunk**: Parameterized `CREATE` with `cast($embedding, 'DOUBLE[1024]')` for the vector column.

**getChunk**: `MATCH (c:Chunk) WHERE c.id = $id RETURN c.*`

**updateChunk**: If embedding changes → delete + re-create. Otherwise → `MATCH ... SET` for changed fields only.

**deleteChunk**: `MATCH (c:Chunk) WHERE c.id = $id DETACH DELETE c` — removes node and all relationships.

**listChunks**: Dynamic WHERE clause built from filters. Parameterized query with LIMIT.

**vectorSearchUnfiltered**: Used for semantic deduplication. Raw vector search with no metadata filters — returns top-K nearest chunks by cosine distance.

---

## Search Operations

**vectorSearch**: `CALL QUERY_VECTOR_INDEX(...)` with post-filtering by domain/category/importance/tags. Returns chunks sorted by cosine distance.

**getRelatedChunks**: Variable-length path traversal across all 4 Chunk→Chunk relationship types. Configurable depth (default 2).

```cypher
MATCH (c:Chunk {id: $id})-[r:RELATES_TO|DEPENDS_ON|CONTRADICTS|SUPERSEDES*1..N]-(related:Chunk)
RETURN DISTINCT related.*
```

**getCodeLinksForChunk**: Iterates over 3 Chunk→CodeEntity relationship types (IMPLEMENTED_BY, TESTED_BY, DEMONSTRATED_IN). Returns entity data with relation description.

**findChunksByDomain**: `WHERE c.domain = $domain`.

**findChunksByKeyword**: `WHERE c.content CONTAINS $keyword OR c.summary CONTAINS $keyword` (case-sensitive on stored lowercase keyword).

---

## Semantic Deduplication

Before every store operation, the embedding is computed and a `vectorSearchUnfiltered(embedding, 1)` is run. If the nearest existing chunk has cosine similarity >= the configured threshold (default 0.95), the store returns the existing chunk ID along with `duplicate_of`, `similarity`, and `existing_summary` fields. This catches reformatted, paraphrased, or slightly edited content that SHA256 hashing would miss.

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

Three maps in `src/types.ts` convert relation strings to KuzuDB table names:

**RELATION_TABLE_MAP** (Chunk → Chunk):

| Key | Table |
|-----|-------|
| `relates_to` | `RELATES_TO` |
| `depends_on` | `DEPENDS_ON` |
| `contradicts` | `CONTRADICTS` |
| `supersedes` | `SUPERSEDES` |

**CODE_RELATION_TABLE_MAP** (Chunk → CodeEntity):

| Key | Table |
|-----|-------|
| `implemented_by` | `IMPLEMENTED_BY` |
| `tested_by` | `TESTED_BY` |
| `demonstrated_in` | `DEMONSTRATED_IN` |

**CODE_CODE_RELATION_TABLE_MAP** (CodeEntity → CodeEntity):

| Key | Table |
|-----|-------|
| `defined_in` | `DEFINED_IN` |
| `imports` | `IMPORTS` |
| `tests` | `TESTS` |
| `code_depends_on` | `CODE_DEPENDS_ON` |
| `implements` | `IMPLEMENTS` |
| `injects` | `INJECTS` |

---

## Type System Reference

### Stored Types

| Interface | Purpose |
|-----------|---------|
| `StoredChunk` | Full chunk as stored in KuzuDB (14 fields including embedding and version) |
| `StoredCodeEntity` | Code entity in KuzuDB (11 fields including embedding) |

### Enums (Type Aliases)

| Type | Values |
|------|--------|
| `ChunkCategory` | rule, pattern, example, reference, learning, workflow, concept |
| `Importance` | critical, high, medium, low |
| `KnowledgeRelation` | relates_to, depends_on, contradicts, supersedes |
| `CodeRelation` | implemented_by, tested_by, demonstrated_in, depends_on, implements, injects |

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

## Error Handling

- "Already exists" errors: silently ignored (idempotent schema creation)
- Connection not initialized: throws immediately
- Prepare failure: throws with KuzuDB error message
- Vector index creation: wrapped in try-catch (may already exist)
