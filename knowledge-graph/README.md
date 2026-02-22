# Knowledge Graph MCP Server

A semantic knowledge base for Claude Code, powered by vector embeddings and graph relationships. Replaces brute-force loading of markdown files with on-demand retrieval that returns only the knowledge Claude actually needs.

## Quick Install

```bash
# From the source directory
bash install.sh

# Or with a custom install location
KG_HOME=~/my-kg bash install.sh
```

The install script will:
1. Copy source to `~/.knowledge-graph/src/`
2. Install npm dependencies and build
3. Symlink `knowledge-graph` to your PATH
4. Pull the `bge-m3` Ollama model (if Ollama is installed)
5. Write MCP config to `~/.claude/settings.json`

## Manual Install

```bash
# 1. Clone/copy to your preferred location
cp -r . ~/.knowledge-graph/src
cd ~/.knowledge-graph/src

# 2. Install and build
npm install
npm run build

# 3. Setup MCP config
node dist/cli.js setup

# 4. Verify
node dist/cli.js doctor
```

## CLI Usage

```bash
knowledge-graph              # Start MCP server (default)
knowledge-graph serve        # Same as above (explicit)
knowledge-graph setup        # Write MCP config to ~/.claude/settings.json
knowledge-graph doctor       # Check Ollama, DB, Node version

# Options
knowledge-graph --db-path ~/my-data/kg    # Custom DB location
knowledge-graph --port 4000               # Custom dashboard port
knowledge-graph --ollama-url http://host:11434  # Custom Ollama endpoint
knowledge-graph --ollama-model nomic-embed-text  # Custom embedding model
knowledge-graph --no-dashboard            # Disable HTTP dashboard
knowledge-graph --help                    # Show help
knowledge-graph --version                 # Show version
```

## The Problem

The project has ~78 skill/rule markdown files totaling ~46K tokens. Loading all of them into every Claude session wastes context window space, increases latency, and dilutes focus. Most sessions only need 2-3 of those files.

## The Solution

An MCP server that:
1. **Stores** knowledge chunks with semantic embeddings (via Ollama/bge-m3)
2. **Links** chunks to each other and to code entities in a graph database (KuzuDB)
3. **Retrieves** relevant chunks using hybrid search: vector similarity + keyword matching + graph traversal
4. **Evolves** knowledge over time with version tracking and archival

Claude decides what metadata to attach. The server handles embedding, storage, linking, and retrieval mechanically.

## Architecture

```
┌──────────────────────────────────────────────┐
│              MCP Server (stdio)               │
│  JSON-RPC ↔ 8 tools ↔ zod validation         │
├──────────────────────────────────────────────┤
│            Tool Handlers (src/tools/)          │
│  store │ query │ link │ link-code │ evolve     │
│  list  │ delete │ ingest                       │
├──────────────────────────────────────────────┤
│          Knowledge Engine (src/engine/)        │
│  Embedder (Ollama) │ Retriever │ Linker        │
├──────────────────────────────────────────────┤
│             Storage (src/storage/)             │
│  KuzuDB: graph + vector (HNSW, cosine)         │
└──────────────────────────────────────────────┘
```

## Project Structure

```
knowledge-graph/
├── src/
│   ├── cli.ts               # CLI entry point (serve, setup, doctor)
│   ├── config.ts             # Config schema, defaults, load/save, merging
│   ├── index.ts              # MCP server, tool registration, startup
│   ├── types.ts              # Interfaces, enums, relation maps, log()
│   ├── kuzu.d.ts             # TypeScript declarations for kuzu module
│   ├── engine/
│   │   ├── embedder.ts       # Ollama bge-m3 client, SHA256 cache
│   │   ├── retriever.ts      # Hybrid search pipeline (vector+keyword+graph)
│   │   └── linker.ts         # Auto-linking by similarity + suggested relations
│   ├── storage/
│   │   └── kuzu.ts           # KuzuDB schema, CRUD, vector search, indices
│   ├── tools/
│   │   ├── store.ts          # Store handler (dedup → embed → create → link)
│   │   ├── query.ts          # Query passthrough to retriever
│   │   ├── evolve.ts         # Evolve handler (archive → re-embed → relink)
│   │   ├── link.ts           # Manual chunk-to-chunk linking
│   │   ├── link-code.ts      # Knowledge-to-code entity linking
│   │   ├── list.ts           # Browse with filters (summary view)
│   │   ├── delete.ts         # Delete chunk and relationships
│   │   └── ingest.ts         # Read file for Claude to analyze
│   └── dashboard/
│       ├── server.ts         # HTTP dashboard server
│       ├── events.ts         # EventBus for real-time updates
│       ├── api.ts            # REST API handlers
│       └── index.html        # Dashboard UI
├── install.sh                # Shell install script
├── package.json
├── tsconfig.json
└── docs/
    └── architecture.md       # Deep technical architecture document
```

## Prerequisites

- **Node.js** >= 18
- **Ollama** running locally (default: `http://localhost:11434`)
- **bge-m3** model pulled in Ollama

## Setup

### 1. Install dependencies

```bash
cd knowledge-graph
npm install
```

### 2. Pull the embedding model

```bash
ollama pull bge-m3
```

### 3. Register as MCP server

**Option A: Automatic setup** (recommended)
```bash
# After building
npm run build
node dist/cli.js setup
```

**Option B: Manual configuration**

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "knowledge-graph": {
      "command": "node",
      "args": ["/path/to/knowledge-graph/dist/cli.js", "serve"],
      "env": {
        "KNOWLEDGE_DB_PATH": "~/.knowledge-graph/data/knowledge"
      }
    }
  }
}
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "knowledge-graph": {
      "command": "node",
      "args": ["/path/to/knowledge-graph/dist/cli.js", "serve"]
    }
  }
}
```

### 4. Start Ollama

```bash
ollama serve
```

The MCP server starts automatically when Claude Code connects.

## Tool Reference

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `knowledge_store` | Store a knowledge chunk | `content` (max 5000), `metadata` (summary, keywords, domain, category, importance, code_refs, suggested_relations) |
| `knowledge_query` | Semantic + graph search | `query`, optional `filters` (domain, category, importance, tags, limit) |
| `knowledge_link` | Link two chunks | `source_id`, `target_id`, `relation` (relates_to, depends_on, contradicts, supersedes) |
| `knowledge_link_code` | Link chunk to code entities | `chunk_id`, `code_entities[]` (name, entity_type, file_path, relation, layer, feature) |
| `knowledge_evolve` | Update chunk with versioning | `id`, `new_content`, `reason`, optional `new_metadata` |
| `knowledge_list` | Browse chunks by filters | optional `filters` (domain, category, importance, tags, source), `limit` (default 50) |
| `knowledge_delete` | Delete chunk + relationships | `id` |
| `knowledge_ingest` | Read file for Claude to chunk | `path` (absolute file path) |

## Usage Examples

### Store knowledge

```json
{
  "content": "Repositories must use registerFactory, never registerLazySingleton, because they need runtime userId/storeId for multi-tenant isolation.",
  "metadata": {
    "summary": "Repository DI must use factory pattern for multi-tenant support",
    "keywords": ["dependency-injection", "repository", "factory", "multi-tenant", "GetIt"],
    "domain": "dependency-injection",
    "category": "rule",
    "importance": "critical",
    "code_refs": [{
      "name": "IProductRepository",
      "entity_type": "interface",
      "file_path": "lib/features/product/domain/repositories/i_product_repository.dart",
      "relation": "implemented_by",
      "layer": "domain"
    }],
    "suggested_relations": [
      { "concept": "state-management", "relation": "relates_to" }
    ]
  }
}
```

### Query knowledge

```json
{
  "query": "how to register repositories in GetIt",
  "filters": {
    "importance": "critical",
    "limit": 5
  }
}
```

### Evolve knowledge

```json
{
  "id": "abc-123-def",
  "new_content": "Updated: Repositories must use registerFactory with closure pattern...",
  "reason": "Added closure pattern example after team discussion",
  "new_metadata": {
    "keywords": ["dependency-injection", "repository", "factory", "closure", "multi-tenant"]
  }
}
```

### Ingest a file

```json
{
  "path": "/absolute/path/to/SKILL.md"
}
```

Claude receives the file content and decides how to chunk and store it via multiple `knowledge_store` calls.

## Configuration

All settings live in `~/.knowledge-graph/knowledge.json`. Run `knowledge-graph setup` to create a default config, then edit it freely.

```json
{
  "db": {
    "path": "~/.knowledge-graph/data/knowledge"
  },
  "ollama": {
    "url": "http://localhost:11434",
    "model": "bge-m3"
  },
  "dashboard": {
    "enabled": true,
    "port": 3333
  },
  "search": {
    "similarityThreshold": 0.82,
    "defaultLimit": 10,
    "autoLinkTopK": 5
  },
  "limits": {
    "maxContentLength": 5000,
    "maxSummaryLength": 200
  },
  "cache": {
    "embeddingCacheSize": 10000
  }
}
```

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `db` | `path` | `~/.knowledge-graph/data/knowledge` | KuzuDB database directory (`~` expanded) |
| `ollama` | `url` | `http://localhost:11434` | Ollama API endpoint |
| `ollama` | `model` | `bge-m3` | Embedding model name |
| `dashboard` | `enabled` | `true` | Enable HTTP dashboard |
| `dashboard` | `port` | `3333` | Dashboard HTTP port |
| `search` | `similarityThreshold` | `0.82` | Min cosine similarity for auto-linking |
| `search` | `defaultLimit` | `10` | Default max results per query |
| `search` | `autoLinkTopK` | `5` | Max auto-link candidates per chunk |
| `limits` | `maxContentLength` | `5000` | Max characters per knowledge chunk |
| `limits` | `maxSummaryLength` | `200` | Max characters per summary |
| `cache` | `embeddingCacheSize` | `10000` | Max cached embeddings (LRU) |

**Priority**: CLI flags > env vars > `knowledge.json` > built-in defaults

### Environment Variables

CLI flags and env vars override the config file:

| Variable | Description |
|----------|-------------|
| `KNOWLEDGE_DB_PATH` | Override `db.path` |
| `OLLAMA_URL` | Override `ollama.url` |
| `OLLAMA_MODEL` | Override `ollama.model` |
| `DASHBOARD_PORT` | Override `dashboard.port` |
| `NO_DASHBOARD` | Set to `1` to override `dashboard.enabled` to false |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Model bge-m3 not found` | Run `ollama pull bge-m3` |
| `Ollama not available` | Start Ollama with `ollama serve` |
| Embedding fails but server runs | Server starts anyway; queries fall back to keyword-only search |
| `Connection not initialized` | Storage failed to init — check `KNOWLEDGE_DB_PATH` is writable |
| Stale results after update | `knowledge_evolve` re-embeds and relinks; old version archived with SUPERSEDES edge |
| Duplicate content detected | Content is semantically deduplicated (cosine similarity >= 0.95); near-identical content returns existing chunk ID with `duplicate_of` and `similarity` fields |
| Dashboard won't start | Port may be in use — try `--port 4000` or check with `knowledge-graph doctor` |

## Further Reading

- [Architecture Deep Dive](docs/architecture.md) — layer-by-layer technical documentation
