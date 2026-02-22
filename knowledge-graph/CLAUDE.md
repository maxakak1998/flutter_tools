# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A semantic knowledge base MCP server for Claude Code. Replaces brute-force loading of ~78 markdown skill files (~46K tokens) with on-demand retrieval using vector embeddings (Ollama/bge-m3) and a graph database (KuzuDB). Exposes 8 tools via JSON-RPC over stdio.

## Commands

```bash
npm install          # Install dependencies
npm run build        # TypeScript → dist/ + copy dashboard HTML
npm run dev          # Dev mode via tsx (no build step)
npm start            # Start MCP server (production, from dist/)
npm run setup        # Register MCP config in ~/.claude/settings.json
npm run doctor       # Health check: Ollama, DB, Node version, dashboard port

bash install.sh      # Full install: copy source, build, pull model, register MCP
```

**Prerequisites**: Node.js >= 18, Ollama running (`ollama serve`), bge-m3 model (`ollama pull bge-m3`)

**IMPORTANT**: After making any code changes, run `bash install.sh` to sync the build to `~/.knowledge-graph/` (the user-scope install). The MCP server runs from `~/.knowledge-graph/src/dist/`, not from this project directory. Without syncing, Claude Code will still use the old code.

## Architecture

```
CLI (cli.ts) → resolves config (CLI flags > env vars > knowledge.json > defaults) → main()
                                                                                      ↓
MCP Server (index.ts) ←── stdio JSON-RPC ←── Claude Code
    ↓ 8 tools, zod-validated
Tool Handlers (src/tools/)
    ↓
Engine Layer (src/engine/)
    ├── Embedder  — Ollama bge-m3, SHA256-keyed LRU cache, batch support
    ├── Retriever — hybrid search: vector + keyword + graph traversal + MMR rerank
    └── Linker    — auto-link by vector similarity, match suggested_relations
    ↓
Storage (src/storage/kuzu.ts) — KuzuDB with HNSW vector index (cosine, 1024 dims)

Dashboard (src/dashboard/) — HTTP + SSE for real-time pipeline visualization
```

### Critical Implementation Details

- **Never use `console.log`** — corrupts JSON-RPC stdio. Use `log()` from `types.ts` (writes to `console.error`).
- **Embedding dimensions fixed at 1024** (`EMBEDDING_DIMENSIONS` in `types.ts`). Tied to DB schema; changing requires migration.
- **KuzuDB cannot SET vector-indexed columns**. `updateChunk()` works around this: save relations → delete node → re-create → restore relations.
- **Content is semantically deduplicated**. Before storing, a vector similarity check (threshold 0.95) catches near-duplicate content — returns existing chunk ID with `duplicate_of` and `similarity` fields.
- **Dashboard auto-kills stale processes** on port conflicts (checks via `lsof` + `ps`, only kills `knowledge-graph`/`cli.js` processes).

### Graph Schema

**Nodes**: `Chunk` (knowledge), `CodeEntity` (code references)

**Chunk Fields**: Each chunk has a `layer` field (`'business-domain'` or `'code-knowledge'`, extensible). Auto-inferred from category if not provided: `concept`/`rule`/`workflow` → `business-domain`; `pattern`/`example`/`learning` → `code-knowledge`.

**Edges**:
- Chunk→Chunk: `RELATES_TO` (has `auto_created` prop), `DEPENDS_ON`, `CONTRADICTS`, `SUPERSEDES` (has `reason` prop), `TRIGGERS`, `REQUIRES`, `PRODUCES`, `IS_PART_OF`, `CONSTRAINS`, `PRECEDES`
- Chunk→CodeEntity: `IMPLEMENTED_BY`, `TESTED_BY`, `DEMONSTRATED_IN` (all have `description` prop)
- CodeEntity→CodeEntity: `DEFINED_IN`, `IMPORTS`, `TESTS`, `CODE_DEPENDS_ON`, `IMPLEMENTS`, `INJECTS`

### Search Pipeline (Retriever)

1. Embed query → 2. Vector search (HNSW, K×2 candidates) → 3. Keyword boost → 4. Graph traversal (depth 1 from top 3 hits) → 5. Score merge: vector 0.6 + keyword 0.2 + graph 0.2 → 6. MMR rerank (λ=0.7) → 7. Enrich with code links. Falls back to keyword-only if embedding fails.

### Auto-Linking (Linker)

On store: creates `RELATES_TO` edges tagged `auto_created: 'true'` for chunks above similarity threshold (default 0.82). On evolve: deletes only auto-created edges, preserves manual links, re-runs auto-linking.

## Configuration

File: `~/.knowledge-graph/knowledge.json` (created by `knowledge-graph setup`)

Key defaults: DB at `~/.knowledge-graph/data/knowledge`, Ollama at `localhost:11434`, dashboard port 3333, similarity threshold 0.82, max content 5000 chars, max summary 200 chars, LRU cache 10K embeddings.

Env var overrides: `KNOWLEDGE_DB_PATH`, `OLLAMA_URL`, `OLLAMA_MODEL`, `DASHBOARD_PORT`, `NO_DASHBOARD=1`.
