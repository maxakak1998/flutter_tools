# MCP Tool Reference

9 tools exposed to Claude via JSON-RPC over stdio.

---

## Overview

| # | Tool | Purpose | When to use |
|---|------|---------|-------------|
| 1 | `knowledge_store` | Store one chunk | Single piece of knowledge with metadata |
| 2 | `knowledge_store_batch` | Store many chunks | Ingesting a file split into N sections (1 Ollama call instead of N) |
| 3 | `knowledge_query` | Search | Find relevant knowledge by natural language |
| 4 | `knowledge_list` | Browse | See what's stored, filter by domain/category/importance |
| 5 | `knowledge_link` | Link chunks | Create manual relationship between two chunks |
| 6 | `knowledge_link_code` | Link chunk to code | Connect knowledge to files, classes, methods |
| 7 | `knowledge_evolve` | Update chunk | New content, re-embed, version bump, archive old |
| 8 | `knowledge_delete` | Delete chunk | Remove chunk and all its relationships |
| 9 | `knowledge_ingest` | Read file | Load file content so Claude can analyze and store it |

---

## 1. knowledge_store

Store a single knowledge chunk. Embeds content, creates graph node, auto-links to similar chunks.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | Knowledge text (max 5000 chars) |
| `metadata.summary` | string | yes | 1-sentence description (max 200 chars) |
| `metadata.keywords` | string[] | yes | 1-15 key terms |
| `metadata.domain` | string | yes | Topic area, kebab-case (e.g. `"dependency-injection"`) |
| `metadata.category` | enum | yes | `rule` `pattern` `example` `reference` `learning` `workflow` `concept` |
| `metadata.importance` | enum | yes | `critical` `high` `medium` `low` |
| `metadata.entities` | string[] | no | Named things (class names, tools) |
| `metadata.suggested_relations` | object[] | no | `{ concept, relation }` — hints for auto-linking |
| `metadata.tags` | string[] | no | Free-form tags |
| `metadata.source` | string | no | Origin file path or identifier |
| `metadata.code_refs` | object[] | no | Links to code (see metadata.md for full schema) |

**Returns**: `{ id, auto_links[], warnings? }`

**Behavior**:
- Semantic dedup: near-identical content (>= 0.95 cosine similarity) returns existing chunk ID with `duplicate_of` and `similarity`
- Embeds via Ollama (1 API call)
- Auto-links to similar chunks above similarity threshold (default 0.82)
- Creates CodeEntity nodes + edges for each `code_ref`

---

## 2. knowledge_store_batch

Store 1-50 chunks in a single call. Same metadata schema as `knowledge_store`, but batch-embeds all chunks in one Ollama call.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `chunks` | array | yes | 1-50 objects, each with `content` + `metadata` (same schema as `knowledge_store`) |

**Returns**: `{ results: StoreResult[], total_created, total_skipped }`

- `results` is in the same order as the input `chunks` array
- Each result has `{ id, auto_links[], warnings? }`
- Skipped duplicates still get an `id` (the existing chunk's ID)

**Behavior**:
- Validates all chunks first — if any chunk fails validation, entire call fails
- Deduplicates against DB and within the batch
- 1 Ollama `embedBatch` call for all new chunks (vs N calls with single store)
- Each chunk still gets individual auto-linking and code_ref processing

**When to prefer over `knowledge_store`**:
- Ingesting a file split into sections
- Storing multiple related rules/patterns at once
- Any time you have 2+ chunks ready to store

---

## 3. knowledge_query

Search the knowledge base using hybrid retrieval: vector similarity + keyword matching + graph traversal.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Natural language search query |
| `filters.domain` | string | no | Filter by domain |
| `filters.category` | string | no | Filter by category |
| `filters.importance` | string | no | Filter by importance |
| `filters.tags` | string[] | no | Filter by tags |
| `filters.limit` | number | no | Max results (default 10) |

**Returns**: `{ chunks: QueryChunk[], total }`

Each `QueryChunk` contains:
- `id`, `content`, `metadata` (summary, keywords, domain, category, importance, version, timestamps)
- `score` — relevance score (0-1)
- `code_links[]` — linked code entities with file paths

**Behavior**:
- Embeds query, runs vector search, expands via graph, merges scores, applies MMR reranking
- Falls back to keyword-only search if Ollama is unavailable

---

## 4. knowledge_list

Browse stored chunks with optional filters. Returns summary view (no content or embeddings).

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `filters.domain` | string | no | Filter by domain |
| `filters.category` | string | no | Filter by category |
| `filters.importance` | string | no | Filter by importance |
| `filters.tags` | string[] | no | Filter by tags |
| `filters.source` | string | no | Filter by source |
| `limit` | number | no | Max results (default 50) |

**Returns**: `{ chunks[], total }`

Each chunk summary: `id`, `summary`, `domain`, `category`, `importance`, `source`, `version`, `updated_at`, `tags`.

---

## 5. knowledge_link

Create a manual relationship between two knowledge chunks.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `source_id` | string | yes | Source chunk ID |
| `target_id` | string | yes | Target chunk ID |
| `relation` | enum | yes | `relates_to` `depends_on` `contradicts` `supersedes` |

**Returns**: `{ created, source_id, target_id, relation }`

**Behavior**:
- Validates both chunks exist
- Creates a directed edge in the graph

---

## 6. knowledge_link_code

Link a knowledge chunk to code entities (files, classes, methods, etc.).

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `chunk_id` | string | yes | Knowledge chunk to link from |
| `code_entities` | array | yes | Code entities to link to |

Each code entity:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Entity name |
| `entity_type` | string | yes | e.g. `class`, `method`, `interface`, `file` |
| `file_path` | string | yes | File path |
| `line_start` | number | no | Starting line |
| `layer` | enum | no | `presentation` `domain` `data` `core` `test` |
| `feature` | string | no | Feature name |
| `signature` | string | no | Type signature |
| `relation` | enum | yes | `implemented_by` `tested_by` `demonstrated_in` `depends_on` `implements` `injects` |
| `via` | string | no | DI mechanism |
| `description` | string | no | Relationship description |

**Returns**: `{ chunk_id, linked_entities[] }`

**Behavior**:
- Creates CodeEntity nodes (with embeddings of `name + type + path`)
- Creates Chunk-to-CodeEntity edges

---

## 7. knowledge_evolve

Update an existing chunk with new content. Archives the old version, re-embeds, bumps version, re-links.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Chunk ID to evolve |
| `new_content` | string | yes | Updated content (max 5000 chars) |
| `new_metadata` | object | no | Partial metadata fields to update |
| `reason` | string | yes | Why this chunk is being updated |

**Returns**: `{ id, version, reason, superseded_id, warnings? }`

**Behavior**:
- Archives old version as a separate chunk (importance forced to `low`, tagged `archived`)
- Creates `SUPERSEDES` edge from current to archive
- Re-embeds new content
- Version bumps (`v1` -> `v2` -> ...)
- Re-runs auto-linking with new embedding
- Note: manual links are lost when embedding changes (KuzuDB limitation)

---

## 8. knowledge_delete

Delete a chunk and all its relationships.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Chunk ID to delete |

**Returns**: `{ deleted, id }`

**Behavior**:
- Uses `DETACH DELETE` — removes the node and every edge touching it
- Irreversible

---

## 9. knowledge_ingest

Read a file from disk so Claude can analyze its content and decide how to store it.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Absolute file path |

**Returns**: File content as text, with path and size metadata.

**Behavior**:
- Reads file, returns raw content to Claude
- If file > 50K chars, appends a warning to chunk it
- Does NOT store anything — Claude decides how to split and calls `knowledge_store_batch` or `knowledge_store`

---

## Typical Workflows

### Ingest a file

```
1. knowledge_ingest(path)          -- read file
2. Claude splits content into logical chunks, generates metadata for each
3. knowledge_store_batch(chunks)   -- store all chunks in one call
```

### Search and explore

```
1. knowledge_query("how to register repositories")   -- find relevant chunks
2. knowledge_list(filters: { domain: "dependency-injection" })  -- browse a domain
```

### Update stale knowledge

```
1. knowledge_list(filters: { source: "path/to/file.md" })  -- find existing chunks
2. knowledge_ingest(path)                                    -- get current content
3. knowledge_evolve(id, new_content, reason)                 -- update changed chunks
4. knowledge_delete(id)                                      -- remove deleted sections
5. knowledge_store(content, metadata)                        -- add new sections
```

### Link knowledge to code

```
1. knowledge_store(content, metadata)                        -- store the rule
2. knowledge_link_code(chunk_id, code_entities)              -- link to implementations
3. knowledge_link(source_id, target_id, "depends_on")        -- link to related rules
```
