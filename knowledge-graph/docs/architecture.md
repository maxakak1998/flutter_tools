# Knowledge Graph Architecture

High-level overview of the system. Each layer has its own deep-dive document.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [4-Layer Architecture](#4-layer-architecture)
3. [Layer Relationships](#layer-relationships)
4. [Data Flows](#data-flows)
5. [Configuration](#configuration)
6. [Known Limitations](#known-limitations)

**Layer deep-dives**:
- [Layer 1: MCP Server](mcp-server.md) — CLI, transport, tool registration, startup, shutdown
- [Layer 2: Tool Handlers](tool-handlers.md) — Each tool handler's flow and behavior
- [Layer 3: Knowledge Engine](engine.md) — Embedder, Retriever (search pipeline), Linker
- [Layer 4: Storage](storage.md) — KuzuDB, schema, CRUD, vector index, graph schema

**Other references**:
- [Metadata Schema](metadata.md) — Metadata standards for knowledge operations
- [MCP Tool Reference](tools.md) — Tool parameter specs and examples

---

## System Overview

### Problem

The project has ~78 markdown skill/rule files totaling ~46K tokens. Loading them all into every Claude session:
- Wastes context window (most sessions need 2-3 files)
- Increases latency and cost
- Dilutes Claude's focus with irrelevant information

### Solution

On-demand semantic + graph retrieval. Instead of blind-loading, Claude queries for what it needs, and the server returns only relevant chunks with their graph connections and code links.

### Design Principle

**Claude = reasoning engine. MCP server = mechanical operations.**

Claude decides:
- What content to store
- What metadata to attach (summary, keywords, domain, category, importance)
- What relations to suggest
- When to evolve or delete knowledge

The server handles:
- Embedding via Ollama
- Graph storage and indexing via KuzuDB
- Hybrid search (vector + keyword + graph)
- Auto-linking by vector similarity
- Version management and archival

---

## 4-Layer Architecture

```
┌─────────────────────────────────────────────────┐
│          CLI (src/cli.ts) + Config (src/config.ts) │
│  Arg parsing · knowledge.json · config resolution  │
├─────────────────────────────────────────────────┤
│         Layer 1: MCP Server (src/index.ts)        │
│  StdioServerTransport ↔ JSON-RPC ↔ 8 tools       │
│  zod validation · startup lifecycle · shutdown     │
├─────────────────────────────────────────────────┤
│         Layer 2: Tool Handlers (src/tools/)        │
│  store · query · evolve · link · link-code         │
│  list · delete · ingest                            │
│  Orchestrate engine + storage for each tool call   │
├─────────────────────────────────────────────────┤
│         Layer 3: Knowledge Engine (src/engine/)    │
│  Embedder: Ollama + LRU SHA256 cache               │
│  Retriever: hybrid search pipeline (7 steps + MMR) │
│  Linker: auto-link by similarity + suggestions     │
├─────────────────────────────────────────────────┤
│         Layer 4: Storage (src/storage/kuzu.ts)     │
│  KuzuDB: embedded graph + vector database          │
│  HNSW index (cosine) · Cypher queries              │
│  2 node tables · 13 relationship tables            │
└─────────────────────────────────────────────────┘
```

---

## Layer Relationships

Dependencies flow **downward only**. Each layer depends on the layer(s) below it, never upward.

```
Layer 1 (MCP Server)
  ├── creates → Layer 3 (Embedder, Retriever, Linker)
  ├── creates → Layer 4 (KuzuStorage)
  └── registers tool handlers that call → Layer 2

Layer 2 (Tool Handlers)
  ├── calls → Layer 3 (Embedder for embedding, Linker for auto-linking)
  └── calls → Layer 4 (Storage for CRUD and search)

Layer 3 (Knowledge Engine)
  └── calls → Layer 4 (Storage for vector search, graph traversal, relations)

Layer 4 (Storage)
  └── owns → KuzuDB (no upward dependencies)
```

**What each layer owns**:

| Layer | Owns | Does NOT own |
|-------|------|-------------|
| 1 — MCP Server | Transport, tool registration, startup/shutdown, config injection | Business logic, data access |
| 2 — Tool Handlers | Orchestration logic per tool, input validation, result formatting | Embedding, search algorithms, DB queries |
| 3 — Engine | Embedding, search pipeline, auto-linking, keyword scoring | Raw DB operations, schema management |
| 4 — Storage | KuzuDB schema, CRUD, vector index, Cypher queries | Business logic, tool semantics |

---

## Data Flows

### Store Flow

```
Claude calls knowledge_store(content, metadata)
  │
  ├─ 1. embedder.embed(content) → DOUBLE[1024]
  ├─ 2. vectorSearchUnfiltered(embedding, 1) → similarity ≥ 0.95? return existing ID + duplicate_of
  ├─ 3. storage.createChunk(UUID, content, embedding, metadata)
  ├─ 4. For each code_ref:
  │     ├─ embedder.embed("name type path")
  │     ├─ storage.createCodeEntity()
  │     └─ storage.createRelation(chunk → code, IMPLEMENTED_BY|TESTED_BY|DEMONSTRATED_IN)
  ├─ 5. linker.autoLink(chunkId, embedding, suggested_relations)
  │     ├─ vectorSearch(embedding, 6) → filter ≥ 0.82 similarity → RELATES_TO edges
  │     └─ For each suggested_relation:
  │           findBestMatch(concept) → domain/keyword/embedding → create edge
  └─ 6. Return { id, auto_links[], warnings[] }
```

### Query Flow

```
Claude calls knowledge_query(query, filters?)
  │
  ├─ 1. embedder.embed(query) → DOUBLE[1024]
  │     └─ On failure: keyword-only fallback
  ├─ 2. storage.vectorSearch(embedding, limit*2, filters) → vector hits
  ├─ 3. extractTerms(query) → lowercase, filter >2 chars, dedupe
  ├─ 4. Graph expansion: top 3 hits → getRelatedChunks(id, depth=1)
  ├─ 5. Merge all candidates with weighted scoring:
  │     ├─ Vector: (1 - distance) × 0.6
  │     ├─ Keyword: computeKeywordScore() × 0.2
  │     └─ Graph: 0.2 (in vector results) or 0.15 (graph-only)
  ├─ 6. MMR rerank (λ=0.7) → top N
  ├─ 7. Enrich each with getCodeLinksForChunk()
  └─ 8. Return { chunks[], total }
```

### Evolve Flow

```
Claude calls knowledge_evolve(id, new_content, new_metadata?, reason)
  │
  ├─ 1. storage.getChunk(id) → existing
  ├─ 2. Archive: storage.createChunk(archive-{uuid8}, old content, importance=low, tag=archived)
  ├─ 3. storage.createRelation(id → archiveId, SUPERSEDES, {reason})
  ├─ 4. embedder.embed(new_content) → new embedding
  ├─ 5. storage.updateChunk(id, merged fields, version+1)
  │     └─ Embedding changed? → DETACH DELETE + CREATE (relationships lost)
  ├─ 6. linker.relinkChunk(id, newEmbedding, suggested_relations)
  └─ 7. Return { id, version, reason, superseded_id }
```

### Ingest → Re-Ingestion Flow

```
Claude calls knowledge_ingest(path)
  │
  ├─ 1. readFile(path, 'utf-8')
  ├─ 2. If >50K chars: append chunking warning
  └─ 3. Return { content, path, size } to Claude
       └─ Claude analyzes content
       └─ Claude calls knowledge_store() N times with chunked content

To update knowledge from a changed source file:
  1. knowledge_list(filters: { source: "path/to/file.md" })
  2. knowledge_ingest(path)
  3. For each chunk:
     ├─ Content changed? → knowledge_evolve(id, new_content, reason)
     ├─ Content removed? → knowledge_delete(id)
     └─ New content? → knowledge_store(content, metadata)
```

---

## Configuration

### Config File

All configurable values live in `~/.knowledge-graph/knowledge.json`. The config module (`src/config.ts`) provides `loadConfig()`, `saveDefaultConfig()`, and `applyOverrides()`.

### Priority Chain

```
CLI flags  >  env vars  >  knowledge.json  >  DEFAULT_CONFIG (config.ts)
(highest)                                      (lowest)
```

### Config Sections

| Section | Key | Default | Consumed By |
|---------|-----|---------|-------------|
| `db` | `path` | `~/.knowledge-graph/data/knowledge` | KuzuStorage |
| `ollama` | `url` | `http://localhost:11434` | Embedder |
| `ollama` | `model` | `bge-m3` | Embedder |
| `dashboard` | `enabled` | `true` | main() |
| `dashboard` | `port` | `3333` | DashboardServer |
| `search` | `similarityThreshold` | `0.82` | Linker |
| `search` | `defaultLimit` | `10` | Retriever |
| `search` | `autoLinkTopK` | `5` | Linker |
| `limits` | `maxContentLength` | `5000` | Zod schemas |
| `limits` | `maxSummaryLength` | `200` | Zod schemas |
| `cache` | `embeddingCacheSize` | `10000` | Embedder LRU cache |

### CLI Flags & Env Vars

| CLI Flag | Env Variable | Maps To |
|----------|-------------|---------|
| `--db-path <path>` | `KNOWLEDGE_DB_PATH` | `db.path` |
| `--ollama-url <url>` | `OLLAMA_URL` | `ollama.url` |
| `--ollama-model <name>` | `OLLAMA_MODEL` | `ollama.model` |
| `--port <port>` | `DASHBOARD_PORT` | `dashboard.port` |
| `--no-dashboard` | `NO_DASHBOARD=1` | `dashboard.enabled = false` |

### Hard Constants

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `EMBEDDING_DIMENSIONS` | 1024 | `types.ts` | bge-m3 vector size, baked into KuzuDB schema |

Changing `EMBEDDING_DIMENSIONS` requires a database migration.

---

## Known Limitations

### CodeEntity Vector Index Not Created

The schema defines `DOUBLE[1024]` embedding on CodeEntity but no vector index is created for it (unlike Chunk which has `chunk_embedding_idx`). CodeEntity search by embedding is not currently used.

**Impact**: None currently. Would need index if code entity similarity search is added.

### No Pagination for Large Result Sets

`knowledge_list` and `knowledge_query` use LIMIT but have no offset/cursor mechanism. Browsing beyond the first N results requires different filters.

**Impact**: Projects with thousands of chunks cannot efficiently browse all of them.

### No TTL/Expiration for Chunks

Chunks persist indefinitely. There is no automatic cleanup of stale knowledge, archived versions, or unused code entities.

**Impact**: Database grows monotonically. Old archived chunks (from evolve) accumulate.

**Mitigation**: Manual cleanup via `knowledge_delete` or periodic maintenance scripts.

### Evolve Loses Relationships

Because of the [vector-indexed column workaround](storage.md#vector-indexed-column-workaround), evolving a chunk that changes its embedding causes `DETACH DELETE` + re-create, which removes all existing relationships. The `relinkChunk()` call after only re-creates auto-links, not manually-created links.

**Impact**: Manual links (`knowledge_link`) are lost when a chunk is evolved.

**Mitigation**: Re-create manual links after evolve, or avoid evolving chunks with important manual relationships.

### ~~Embedding Cache is Unbounded~~ (RESOLVED)

The embedding cache is now an LRU with configurable max size (`cache.embeddingCacheSize`, default: 10,000).

### ~~relinkChunk Doesn't Remove Old Auto-Links~~ (RESOLVED)

`linker.relinkChunk()` now calls `storage.deleteAutoRelations(chunkId)` first.
