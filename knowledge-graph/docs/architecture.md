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
- [Layer 3: Knowledge Engine](engine.md) — Embedder, Retriever (search pipeline), Linker, Confidence
- [Layer 4: Storage](storage.md) — IStorage abstraction, KuzuDB + SurrealDB backends, schema, CRUD, vector index

**Other references**:
- [Metadata Schema](metadata.md) — Metadata standards for knowledge operations
- [MCP Tool Reference](tools.md) — Tool parameter specs and examples
- [Claude Interaction Guide](claude-interaction.md) — Full interaction flows between Claude Code and the MCP server

---

## System Overview

### Problem

The project has ~78 markdown skill/rule files totaling ~46K tokens. Loading them all into every Claude session:
- Wastes context window (most sessions need 2-3 files)
- Increases latency and cost
- Dilutes Claude's focus with irrelevant information

### Solution

On-demand semantic + graph retrieval. Instead of blind-loading, Claude queries for what it needs, and the server returns only relevant chunks with their graph connections.

### Design Principle

**Claude = reasoning engine. MCP server = mechanical operations.**

Claude decides:
- What content to store
- What metadata to attach (summary, keywords, domain, category, importance)
- What relations to suggest
- When to evolve or delete knowledge

The server handles:
- Embedding via Ollama
- Graph storage and indexing via KuzuDB or SurrealDB
- Hybrid search (vector + keyword + graph)
- Auto-linking by vector similarity
- Version management and archival

---

## 4-Layer Architecture

```
┌─────────────────────────────────────────────────┐
│   Entry Point: CLI (src/cli.ts) + Config (src/config.ts) │
│   Arg parsing · knowledge.json · config resolution       │
├─────────────────────────────────────────────────┤
│         Layer 1: MCP Server (daemon + client)       │
│  client.ts (stdio MCP) ↔ daemon.ts (HTTP JSON-RPC) │
│  zod validation · startup lifecycle · shutdown     │
│  http-utils.ts · version.ts                         │
├─────────────────────────────────────────────────┤
│         Layer 2: Tool Handlers (src/tools/)        │
│  store · query · evolve · link · validate · promote │
│  list · delete                                     │
│  Orchestrate engine + storage for each tool call   │
├─────────────────────────────────────────────────┤
│         Layer 3: Knowledge Engine (src/engine/)    │
│  Embedder: Ollama + LRU SHA256 cache               │
│  Retriever: hybrid search pipeline                  │
│  Linker: auto-link by similarity + suggestions     │
│  Confidence: confirmation/refutation + decay        │
├─────────────────────────────────────────────────┤
│         Layer 4: Storage (src/storage/)             │
│  IStorage interface + backend factory               │
│  KuzuDB (default) or SurrealDB (opt-in)            │
│  HNSW index (cosine) · 1 node table · 15 relations │
└─────────────────────────────────────────────────┘
```

---

## Layer Relationships

Dependencies flow **downward only**. Each layer depends on the layer(s) below it, never upward.

```
Layer 1 (MCP Server)
  ├── creates → Layer 3 (Embedder, Retriever, Linker)
  ├── creates → Layer 4 (IStorage via createStorage factory)
  └── registers tool handlers that call → Layer 2

Layer 2 (Tool Handlers)
  ├── calls → Layer 3 (Embedder for embedding, Linker for auto-linking)
  └── calls → Layer 4 (Storage for CRUD and search)

Layer 3 (Knowledge Engine)
  └── calls → Layer 4 (Storage for vector search, graph traversal, relations)

Layer 4 (Storage)
  └── owns → KuzuDB or SurrealDB (no upward dependencies)
```

**What each layer owns**:

| Layer | Owns | Does NOT own |
|-------|------|-------------|
| 1 — MCP Server | Transport, tool registration, startup/shutdown, config injection, localhost-only origin checks, request-size enforcement, runtime version reporting | Business logic, data access |
| 2 — Tool Handlers | Orchestration logic per tool, input validation, result formatting | Embedding, search algorithms, DB queries |
| 3 — Engine | Embedding, search pipeline, auto-linking, keyword scoring | Raw DB operations, schema management |
| 4 — Storage | IStorage abstraction, backend-specific schema/CRUD/vector index | Business logic, tool semantics |

---

## Data Flows

### Store Flow

```
Claude calls knowledge_store(content, metadata)
  │
  ├─ 1. embedder.embed(content) → DOUBLE[1024]
  ├─ 2. vectorSearchUnfiltered(embedding, 1) → similarity ≥ 0.88? return existing ID + duplicate_of
  ├─ 3. vectorSearchUnfiltered(embedding, 5) → proactive surfacing (validated/canonical/promoted, sim 0.60–0.88)
  ├─ 4. Normalize metadata, infer layer, set learning defaults
  ├─ 5. storage.createChunk(UUID, content, embedding, metadata)
  ├─ 6. linker.autoLink(chunkId, embedding, suggested_relations)
  │     ├─ vectorSearch(embedding, autoLinkTopK + 1) → filter ≥ 0.82 similarity → RELATES_TO edges
  │     │   (default: autoLinkTopK=5, so 6 candidates to exclude self-match)
  │     └─ For each suggested_relation:
  │           findBestMatch(concept) → domain/keyword/embedding → create edge
  └─ 7. Return { id, auto_links[], warnings[], related_knowledge[]? }
```

### Query Flow

```
Claude calls knowledge_query(query, filters?)
  │
  ├─ 1. embedder.embed(query) → DOUBLE[1024]
  │     └─ On failure: keyword-only fallback
  ├─ 2. storage.vectorSearch(embedding, 50, filters) → vector hits
  ├─ 3. extractTerms(query) → lowercase, filter >2 chars, dedupe
  ├─ 4. Graph expansion: top 3 hits → getRelatedChunks(id, depth=1)
  ├─ 5. Merge all candidates with weighted scoring:
  │     ├─ Vector: (1 - distance) × 0.55
  │     ├─ Keyword: computeKeywordScore() × 0.2
  │     ├─ Graph: 0.2 (in vector results) or 0.15 (graph-only)
  │     └─ Confidence boost: (effective_confidence - 0.5) × weight
  ├─ 6. Sort by score, filter refuted, post-filters (min_confidence, lifecycle, since)
  └─ 7. Return { chunks[], total }
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
  │     └─ Embedding changed? → KuzuDB: save relations → DETACH DELETE + CREATE → restore; SurrealDB: direct UPDATE
  ├─ 6. linker.relinkChunk(id, newEmbedding, suggested_relations)
  └─ 7. Return { id, version, reason, superseded_id, note }
```

### Re-Ingestion Flow

```
To update knowledge from a changed source file:
  1. knowledge_list(filters: { source: "path/to/file.md" })
  2. Read the file (Claude's built-in Read tool)
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
| `storage` | `backend` | `kuzu` | createStorage factory |
| `db` | `path` | `~/.knowledge-graph/data/knowledge` | IStorage backend |
| `ollama` | `url` | `http://localhost:11434` | Embedder |
| `ollama` | `model` | `bge-m3` | Embedder |
| `search` | `similarityThreshold` | `0.82` | Linker |
| `search` | `autoLinkTopK` | `5` | Linker |
| `dedup` | `similarityThreshold` | `0.88` | Store (dedup check) |
| `cache` | `embeddingCacheSize` | `10000` | Embedder LRU cache |
| `learning` | `autoPromoteConfidence` | `0.85` | Validate (auto-promote) |
| `learning` | `autoPromoteValidations` | `3` | Validate (auto-promote) |
| `learning` | `confirmationBoost` | `0.25` | Validate (confirmation) |
| `learning` | `refutationPenalty` | `0.15` | Validate (refutation) |
| `learning` | `confidenceSearchWeight` | `0.1` | Retriever (scoring) |
| `learning` | `hypothesisInitialConfidence` | `0.3` | Store (learning defaults) |
| `learning` | `decayRates.*` | `0.95` (default) | List, Retriever (temporal decay) |

### CLI Flags & Env Vars

| CLI Flag | Env Variable | Maps To |
|----------|-------------|---------|
| `--storage <backend>` | `KNOWLEDGE_STORAGE_BACKEND` | `storage.backend` |
| `--db-path <path>` | `KNOWLEDGE_DB_PATH` | `db.path` |
| `--ollama-url <url>` | `OLLAMA_URL` | `ollama.url` |
| `--ollama-model <name>` | `OLLAMA_MODEL` | `ollama.model` |

### Hard Constants

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `EMBEDDING_DIMENSIONS` | 1024 | `types.ts` | bge-m3 vector size, baked into both KuzuDB and SurrealDB schemas |
| `MAX_REQUEST_BODY_BYTES` | 1048576 (1 MB) | `http-utils.ts` | Shared POST body size limit for daemon RPC and dashboard trigger routes |

Changing `EMBEDDING_DIMENSIONS` requires a database migration.

---

## Known Limitations

### Localhost-Only HTTP Surface

The daemon binds to `127.0.0.1`. Browser-facing dashboard routes and SSE subscriptions accept origins only from `127.0.0.1`, `localhost`, or `::1`. Shared request parsing in `src/http-utils.ts` enforces a 1 MB limit on POST bodies for RPC and dashboard trigger routes.

### No Pagination for Large Result Sets

`knowledge_list` and `knowledge_query` use LIMIT but have no offset/cursor mechanism. Browsing beyond the first N results requires different filters.

**Impact**: Projects with thousands of chunks cannot efficiently browse all of them.

### No TTL/Expiration for Chunks

Chunks persist indefinitely. There is no automatic cleanup of stale knowledge or archived versions.

**Impact**: Database grows monotonically. Old archived chunks (from evolve) accumulate.

**Mitigation**: Manual cleanup via `knowledge_delete` or periodic maintenance scripts.

### ~~Evolve Loses Relationships~~ (RESOLVED)

`updateChunk()` now uses `saveChunkRelations()`/`restoreChunkRelations()` to preserve ALL relationships (both auto-created and manual) across the DETACH DELETE + re-create cycle. The `relinkChunk()` call after only refreshes auto-created links.

### ~~Embedding Cache is Unbounded~~ (RESOLVED)

The embedding cache is now an LRU with configurable max size (`cache.embeddingCacheSize`, default: 10,000).

### ~~relinkChunk Doesn't Remove Old Auto-Links~~ (RESOLVED)

`linker.relinkChunk()` now calls `storage.deleteAutoRelations(chunkId)` first.
