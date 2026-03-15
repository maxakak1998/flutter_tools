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
3. Symlink `knowledge-graph` (alias: `kg`) to your PATH
4. Pull the `bge-m3` Ollama model (if Ollama is installed)
5. Write default config and print MCP registration instructions

## CLI Usage

```bash
knowledge-graph                    # Show help text
knowledge-graph serve              # Start MCP server (auto-detects project)
knowledge-graph stop               # Stop the running daemon for the current project
knowledge-graph init [--force]     # Initialize .knowledge-graph/ in current directory
knowledge-graph serve-standalone   # Start daemon + dashboard (no MCP, standalone mode)
knowledge-graph setup              # Write config + print MCP registration instructions
knowledge-graph doctor             # Check dependencies (Ollama, DB, Node, daemon)
knowledge-graph reset-db           # Delete the database (all chunks, edges, embeddings)
knowledge-graph uninstall          # Remove installed files, config, and MCP registration

# Options
knowledge-graph --db-path ~/my-data/kg              # Custom DB location
knowledge-graph --ollama-url http://host:11434       # Custom Ollama endpoint
knowledge-graph --ollama-model nomic-embed-text      # Custom embedding model
knowledge-graph --keep-data                          # Keep database on uninstall
knowledge-graph --help                               # Show help
knowledge-graph --version                            # Show version
```

## The Problem

The project has ~78 skill/rule markdown files totaling ~46K tokens. Loading all of them into every Claude session wastes context window space, increases latency, and dilutes focus. Most sessions only need 2-3 of those files.

## The Solution

An MCP server that:
1. **Stores** knowledge chunks with semantic embeddings (via Ollama/bge-m3)
2. **Links** chunks to each other in a graph database (KuzuDB)
3. **Retrieves** relevant chunks using hybrid search: vector similarity + keyword matching + graph traversal + confidence boost
4. **Evolves** knowledge over time with version tracking and archival
5. **Validates** knowledge through confirmation/refutation with lifecycle management

Claude decides what metadata to attach. The server handles embedding, storage, linking, and retrieval mechanically.

## Architecture

```
Claude Code <─stdio MCP─> client.ts <─HTTP JSON-RPC─> daemon.ts <──> KuzuDB
                                                          |
                                                     Dashboard (HTTP + SSE)
```

```
┌──────────────────────────────────────────────────┐
│         Entry Point: CLI (src/cli.ts)             │
│  Arg parsing · config resolution · project detect │
├──────────────────────────────────────────────────┤
│       Layer 1: MCP Server (daemon + client)       │
│  client.ts (stdio MCP) <-> daemon.ts (HTTP RPC)   │
│  zod validation · startup lifecycle · shutdown     │
├──────────────────────────────────────────────────┤
│       Layer 2: Tool Handlers (src/tools/)          │
│  store | query | list | link | evolve              │
│  delete | validate | promote                       │
├──────────────────────────────────────────────────┤
│       Layer 3: Knowledge Engine (src/engine/)      │
│  Embedder (Ollama) | Retriever | Linker            │
│  Confidence scoring + temporal decay               │
├──────────────────────────────────────────────────┤
│       Layer 4: Storage (src/storage/kuzu.ts)       │
│  KuzuDB: graph + vector (HNSW, cosine, 1024 dims) │
│  1 node table · 15 relationship tables             │
└──────────────────────────────────────────────────┘
```

## Project Structure

```
knowledge-graph/
├── src/
│   ├── cli.ts               # CLI entry point (serve, init, stop, setup, doctor, etc.)
│   ├── config.ts            # Config schema, defaults, load/save, merging
│   ├── client.ts            # MCP stdio-to-HTTP proxy (forwards tool calls to daemon)
│   ├── daemon.ts            # HTTP server, owns KuzuDB lock, hosts dashboard
│   ├── daemon-manager.ts    # Ensures daemon is running, spawns if needed
│   ├── core.ts              # Creates and wires engine components (used by daemon)
│   ├── project.ts           # Per-project .knowledge-graph/ management, discovery
│   ├── rpc.ts               # JSON-RPC 2.0 request/response utilities
│   ├── types.ts             # Interfaces, enums, relation maps, log()
│   ├── engine/
│   │   ├── embedder.ts      # Ollama bge-m3 client, SHA256-keyed LRU cache
│   │   ├── retriever.ts     # Hybrid search pipeline (vector+keyword+graph+confidence)
│   │   ├── linker.ts        # Auto-linking by similarity + suggested relations
│   │   └── confidence.ts    # Confirmation/refutation formulas, temporal decay
│   ├── storage/
│   │   └── kuzu.ts          # KuzuDB schema, CRUD, vector search, indices
│   ├── tools/
│   │   ├── store.ts         # Store handler (dedup, embed, create, link, proactive surfacing)
│   │   ├── query.ts         # Query passthrough to retriever
│   │   ├── evolve.ts        # Evolve handler (archive, re-embed, relink, preserve learning)
│   │   ├── link.ts          # Manual chunk-to-chunk linking
│   │   ├── list.ts          # Browse with filters (summary view + effective confidence)
│   │   ├── delete.ts        # Delete chunk and relationships
│   │   ├── validate.ts      # Confirm/refute handler (lifecycle state machine)
│   │   └── promote.ts       # Promote handler (lifecycle graduation)
│   └── dashboard/
│       ├── server.ts        # Dashboard HTTP handler + SSE event streaming
│       ├── events.ts        # EventBus for real-time pipeline visualization
│       ├── api.ts           # REST API handlers (stats, graph, chunks)
│       └── index.html       # Dashboard SPA (graph viz, event timeline)
├── scripts/
│   └── regression-test.ts   # 19-test regression suite
├── install.sh               # Shell install script
├── package.json
├── tsconfig.json
└── docs/                    # Deep-dive documentation
```

## Prerequisites

- **Node.js** >= 18
- **Ollama** running locally (default: `http://localhost:11434`)
- **bge-m3** model pulled in Ollama

## Setup

### 1. Install and build

```bash
cd knowledge-graph
npm install
npm run build
```

### 2. Pull the embedding model

```bash
ollama pull bge-m3
```

### 3. Initialize a project

```bash
cd /path/to/your/project
knowledge-graph init
```

This creates a `.knowledge-graph/` directory in your project (like `.git/`).

### 4. Register as MCP server

Add to your project's `.mcp.json`:

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

Or run `knowledge-graph setup` to see the exact config for your installation.

### 5. Start Ollama

```bash
ollama serve
```

The MCP server starts automatically when Claude Code connects.

## Tool Reference

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `knowledge_store` | Store a knowledge chunk | `content` (max 5000), `metadata` (summary, keywords, domain, category, importance, entities?, suggested_relations?, tags?, source?) |
| `knowledge_query` | Semantic + graph search | `query`, optional `filters` (domain, category, importance, tags, layer, min_confidence, lifecycle, since) |
| `knowledge_list` | Browse chunks by filters | optional `filters` (domain, category, importance, tags, source, layer, min_confidence, lifecycle, since), `limit` (default 50) |
| `knowledge_link` | Link two chunks | `source_id`, `target_id`, `relation` (15 types: relates_to, depends_on, contradicts, supersedes, triggers, requires, produces, is_part_of, constrains, precedes, is_true, is_false, transitions_to, mutates, governed_by) |
| `knowledge_evolve` | Update chunk with versioning | `id`, `new_content`, `reason`, optional `new_metadata` |
| `knowledge_delete` | Delete chunk + relationships | `id` |
| `knowledge_validate` | Confirm or refute knowledge | `id`, `action` (confirm/refute), optional `evidence`, `context` |
| `knowledge_promote` | Graduate lifecycle status | `id`, `reason`, optional `new_category`, `new_importance` |

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
    "entities": ["IProductRepository", "GetIt"],
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
    "importance": "critical"
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

### Validate knowledge

```json
{
  "id": "abc-123-def",
  "action": "confirm",
  "evidence": "Confirmed in src/config.ts:42 — factory pattern is used"
}
```

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
  "search": {
    "similarityThreshold": 0.82,
    "autoLinkTopK": 5
  },
  "cache": {
    "embeddingCacheSize": 10000
  },
  "dedup": {
    "similarityThreshold": 0.88
  },
  "learning": {
    "autoPromoteConfidence": 0.85,
    "autoPromoteValidations": 3,
    "confirmationBoost": 0.25,
    "refutationPenalty": 0.15,
    "confidenceSearchWeight": 0.1,
    "hypothesisInitialConfidence": 0.3,
    "decayRates": {
      "default": 0.95,
      "fact": 1.0,
      "rule": 1.0,
      "insight": 0.95,
      "question": 0.90,
      "workflow": 0.98
    }
  }
}
```

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `db` | `path` | `~/.knowledge-graph/data/knowledge` | KuzuDB database directory (`~` expanded) |
| `ollama` | `url` | `http://localhost:11434` | Ollama API endpoint |
| `ollama` | `model` | `bge-m3` | Embedding model name |
| `search` | `similarityThreshold` | `0.82` | Min cosine similarity for auto-linking |
| `search` | `autoLinkTopK` | `5` | Max auto-link candidates per chunk |
| `cache` | `embeddingCacheSize` | `10000` | Max cached embeddings (LRU) |
| `dedup` | `similarityThreshold` | `0.88` | Min cosine similarity for deduplication |
| `learning` | `autoPromoteConfidence` | `0.85` | Min confidence for auto-promotion |
| `learning` | `autoPromoteValidations` | `3` | Min validations for auto-promotion |
| `learning` | `confirmationBoost` | `0.25` | Base boost per confirmation (diminishing) |
| `learning` | `refutationPenalty` | `0.15` | Base penalty per refutation (amplifying) |
| `learning` | `confidenceSearchWeight` | `0.1` | Weight of confidence in search scoring |
| `learning` | `hypothesisInitialConfidence` | `0.3` | Starting confidence for insights/questions |
| `learning` | `decayRates.*` | `0.95` (default) | Monthly confidence decay rate per category |

**Priority**: CLI flags > env vars > `knowledge.json` > built-in defaults

### Environment Variables

CLI flags and env vars override the config file:

| Variable | Description |
|----------|-------------|
| `KNOWLEDGE_DB_PATH` | Override `db.path` |
| `OLLAMA_URL` | Override `ollama.url` |
| `OLLAMA_MODEL` | Override `ollama.model` |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Model bge-m3 not found` | Run `ollama pull bge-m3` |
| `Ollama not available` | Start Ollama with `ollama serve` |
| Embedding fails but server runs | Server starts anyway; queries fall back to keyword-only search |
| `Connection not initialized` | Storage failed to init — check `KNOWLEDGE_DB_PATH` is writable |
| Stale results after update | `knowledge_evolve` re-embeds and relinks; old version archived with SUPERSEDES edge |
| Duplicate content detected | Content is semantically deduplicated (cosine similarity >= 0.88); near-identical content returns existing chunk ID with `duplicate_of` and `similarity` fields |
| Dashboard won't start | Dashboard shares the daemon's auto-assigned port — check `knowledge-graph doctor` |
| `No .knowledge-graph/ found` | Run `knowledge-graph init` in your project directory first |

## Further Reading

- [Architecture Overview](docs/architecture.md) — 4-layer architecture, data flows, config reference
- [MCP Server](docs/mcp-server.md) — CLI commands, startup/shutdown lifecycle, error handling
- [Tool Handlers](docs/tool-handlers.md) — Each tool handler's flow and behavior
- [Tool Reference](docs/tools.md) — Tool parameter specs and examples
- [Knowledge Engine](docs/engine.md) — Embedder, Retriever, Linker, Confidence
- [Storage](docs/storage.md) — KuzuDB schema, CRUD, vector index, graph schema
- [Metadata Schema](docs/metadata.md) — Metadata standards for knowledge operations
- [Claude Interaction Guide](docs/claude-interaction.md) — Full interaction flows between Claude Code and the MCP server
