# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A continuous learning knowledge graph MCP server for Claude Code. Stores natural language knowledge as atomic nodes with semantic embeddings (Ollama/bge-m3) in a graph database. Supports two storage backends: **KuzuDB** (default) and **SurrealDB** (embedded mode). Features confidence scoring, lifecycle management, temporal decay, validation/refutation, and proactive surfacing. Exposes 8 tools via JSON-RPC.

## Commands

```bash
npm install          # Install dependencies
npm run build        # TypeScript → dist/ + copy dashboard HTML
npm run dev          # Dev mode via tsx (no build step)
npm start            # Start MCP server (production, from dist/)
npm run setup        # Write default config + print MCP registration instructions
npm run doctor       # Health check: Ollama, DB, Node version, daemon

bash install.sh      # Full install: copy source, build, pull model, register MCP
```

**Prerequisites**: Node.js >= 18, Ollama running (`ollama serve`), bge-m3 model (`ollama pull bge-m3`)

**IMPORTANT**: After making any code changes, run `bash install.sh` to sync the build to `~/.knowledge-graph/` (the user-scope install). The MCP server runs from `~/.knowledge-graph/src/dist/`, not from this project directory. Without syncing, Claude Code will still use the old code.

### CLI Commands

| Command | Description |
|---------|-------------|
| `serve` | Start MCP server (requires `.knowledge-graph/` — run `init` first) |
| `stop` | Stop the running daemon for the current project |
| `init [--force]` | Initialize `.knowledge-graph/` in current directory |
| `serve-standalone` | Start daemon + dashboard without MCP (standalone browsing mode) |
| `setup` | Write default config + print MCP registration instructions |
| `doctor` | Check dependencies (Ollama, DB, Node, daemon, port) |
| `reset-db` | Delete the database (all chunks, edges, embeddings) |
| `uninstall` | Remove installed files, config, and MCP registration |

### CLI Options

| Option | Description |
|--------|-------------|
| `--storage <backend>` | Storage backend: `kuzu` or `surreal` (default: kuzu) |
| `--db-path <path>` | Override database path |
| `--ollama-url <url>` | Ollama API endpoint |
| `--ollama-model <name>` | Embedding model name |
| `--force, -f` | Force init even if parent has `.knowledge-graph/` |
| `--keep-data` | Keep database on uninstall |
| `--help, -h` | Print help text |
| `--version, -v` | Print version |

## Architecture

### Operating Mode

The server requires a `.knowledge-graph/` directory (created by `kg init`). A background daemon owns the database. The MCP client is a thin proxy that forwards tool calls over HTTP. If no `.knowledge-graph/` is found, the server exits with an error instructing the user to run `knowledge-graph init`.

```
Claude Code ←stdio MCP→ client.ts ←HTTP JSON-RPC→ daemon.ts ←→ KuzuDB/SurrealDB
                                                       ↕
                                                  Dashboard (HTTP + SSE)
```

### Component Overview

```
CLI (cli.ts) → discover project → daemon + client mode
                                        ↓
  daemon-manager.ts  → ensures daemon is running, spawns if needed
  daemon.ts          → HTTP server, owns DB lock, hosts dashboard
  client.ts          → stdio MCP proxy, forwards tool calls to daemon via HTTP
  rpc.ts             → JSON-RPC 2.0 request/response utilities
  core.ts            → creates and wires engine components (used by daemon)
  project.ts         → per-project .knowledge-graph/ management, discovery, registry
  engine/embedder.ts → Ollama bge-m3, SHA256-keyed LRU cache
  engine/retriever.ts → hybrid search: vector + keyword + graph + confidence boost
  engine/linker.ts    → auto-link by vector similarity, match suggested_relations
  engine/confidence.ts → confirmation/refutation formulas, temporal decay
  storage/interface.ts → IStorage abstraction + backend factory
  storage/kuzu.ts     → KuzuDB backend (HNSW vector index, cosine, 1024 dims)
  storage/surreal.ts  → SurrealDB backend (embedded mode via @surrealdb/node)
  tools/*.ts          → 8 tool handlers
  dashboard/          → HTTP + SSE for real-time pipeline visualization
```

### Daemon Architecture (`daemon.ts`)

- Spawned by `daemon-manager.ts` via `child_process.fork()` with `detached: true`
- Requires 3 env vars: `KG_DAEMON_CONFIG` (JSON config), `KG_PROJECT_DIR` (`.knowledge-graph/` path), `KG_PROJECT_ID` (project identifier). Also reads `KG_IDLE_TIMEOUT_MS` (default 300000) and `KG_PORT_RANGE_START` (default 0 = auto-assign).
- Owns the database lock — only one daemon per project
- Serves JSON-RPC over HTTP on `127.0.0.1` (auto-assigned port)
- Writes port to `.knowledge-graph/daemon.port`, PID to `daemon.pid`
- Hosts dashboard on same HTTP server (delegates non-RPC routes)
- Client tracking: `/rpc/connect` increments, `/rpc/disconnect` decrements
- Idle timer starts immediately on startup (before any client connects); reset on `/rpc/connect`, restarted on `/rpc/disconnect` when no clients remain
- Auto-shutdown after idle timeout (default 300s, configurable per project via `daemon.idle_timeout_ms`)
- Health endpoint: `GET /health` returns `{ status, project_id, clients, uptime_ms }`
- Graceful shutdown via `/rpc/shutdown` or SIGTERM/SIGINT

### Daemon Manager (`daemon-manager.ts`)

`ensureDaemon()` handles daemon lifecycle:
1. Check `daemon.port` file → health check existing daemon (verifies `status === 'ok'` AND `project_id` matches current project)
2. Check `daemon.pid` file → detect zombie processes
3. If no valid daemon → `fork()` new daemon, poll for `daemon.port` file (15s timeout)

### Client Proxy (`client.ts`)

- Speaks MCP protocol (stdio) to Claude Code
- Forwards all tool calls to daemon via HTTP `POST /rpc`
- On `SIGINT` (Ctrl+C): kills daemon via `/rpc/shutdown`
- On `SIGTERM` (Claude Code exit): disconnects via `/rpc/disconnect`, preserves daemon

### Project System (`project.ts`)

Per-project knowledge graphs via `.knowledge-graph/` directories:

```
.knowledge-graph/
├── config.json        # Project ID, name, daemon settings
├── data/knowledge     # Database files (gitignored)
├── daemon.port        # Running daemon port (gitignored)
└── daemon.pid         # Running daemon PID (gitignored)
```

- `discoverProject()`: checks CWD for `.knowledge-graph/config.json`
- `initProject()`: creates `.knowledge-graph/` with config, data dir, appends to `.gitignore`
- Global registry at `~/.knowledge-graph/registry.json` tracks all known projects
- Nested project prevention: `init` refuses if parent already has `.knowledge-graph/` (use `--force` to override)

### Critical Implementation Details

- **Never use `console.log`** — corrupts JSON-RPC stdio. Use `log()` from `types.ts` (writes to `console.error`).
- **No batch store** — all stores are single-chunk to ensure dedup feedback is processed per-chunk.
- **CLI auto-kills stale processes** during `reset-db` (checks via `ps`, only kills `node cli.js serve` processes). The `serve` command uses `ensureDaemon()` instead, which health-checks existing daemons and spawns a new one if needed.
- **Storage abstraction** — All storage access goes through `IStorage` interface (`storage/interface.ts`). Backend is selected by `createStorage(backend, dbPath)` factory. Tool handlers and engine components are backend-agnostic.

### Graph Schema

**Node Table**: Single `Chunk` table. All knowledge is stored as chunks with metadata fields. KuzuDB uses a node table; SurrealDB uses a SCHEMAFULL table with the same fields.

**Chunk Fields**: Each chunk has a `layer` field (`core-knowledge`, `learning`, `procedural`, or custom). Auto-inferred from category if not provided.

**Learning Fields** (per chunk):

| Field | Type | Default | Purpose |
|---|---|---|---|
| `confidence` | DOUBLE | 0.5 | Trust score 0.0–1.0 |
| `validation_count` | INT64 | 0 | Times confirmed |
| `refutation_count` | INT64 | 0 | Times refuted |
| `last_validated_at` | STRING | '' | ISO timestamp of last validation |
| `lifecycle` | STRING | 'active' | hypothesis/validated/promoted/canonical/refuted/active |
| `access_count` | INT64 | 0 | Times retrieved via query |

### Categories (5)

| Category | Meaning | Size Target | Initial Lifecycle | Initial Confidence |
|---|---|---|---|---|
| `fact` | A verifiable statement or piece of knowledge | 500 chars | `active` | 0.5 |
| `rule` | A constraint, principle, or guideline | 800 chars | `active` | 0.5 |
| `insight` | A discovered pattern, learning, or understanding | 600 chars | `hypothesis` | 0.3 |
| `question` | An open question to investigate or resolve | 400 chars | `hypothesis` | 0.3 |
| `workflow` | A process, sequence of steps, or procedure | 800 chars | `active` | 0.5 |

**Why categories matter**: Layer auto-inference, content size warnings, predictable filtering. Categories do NOT affect search scoring, auto-linking, or deduplication.

### Edges

Chunk→Chunk only (15 relation types): `RELATES_TO` (has `auto_created`), `DEPENDS_ON` (has `auto_created` via migration), `CONTRADICTS` (has `auto_created` via migration), `SUPERSEDES` (has `reason`), `TRIGGERS` through `GOVERNED_BY` (each has `description` + `auto_created`). Full list: `RELATES_TO`, `DEPENDS_ON`, `CONTRADICTS`, `SUPERSEDES`, `TRIGGERS`, `REQUIRES`, `PRODUCES`, `IS_PART_OF`, `CONSTRAINS`, `PRECEDES`, `IS_TRUE`, `IS_FALSE`, `TRANSITIONS_TO`, `MUTATES`, `GOVERNED_BY`.

All 15 relations are available via `knowledge_link`. However, `suggested_relations` in metadata accepts only 14 — `supersedes` is excluded because it is system-managed (created automatically by `knowledge_evolve` when archiving old versions).

Relation mappings defined in `types.ts`: `RELATION_TABLE_MAP`.

## Continuous Learning System

### Lifecycle State Machine

```
  hypothesis ──[confirm x3 + conf≥0.85]──> validated ──[promote]──> promoted ──[conf≥0.9]──> canonical
       │                                                                │                        │
       └────[refute + conf<0.2]─────────> refuted <─────────────────────┘────[refute + conf<0.2]─┘
                                             │
                                             └──[confirm + conf≥0.2]──> hypothesis

  active ──[promote]──> promoted   (direct path for fact/rule/workflow chunks)
```

- `active` = default for `fact`, `rule`, `workflow` chunks. Can be promoted directly to `promoted` via `knowledge_promote`.
- `hypothesis` = auto-set for `insight` and `question` chunks (confidence starts at 0.3)
- `refuted` = chunks hidden from search by default (unless `lifecycle: 'refuted'` filter is explicit)

### Validation Policy (Golden Evidence)

Promotion from `validated` → `promoted` requires verification against **all 4 golden evidence sources**. This is a behavioral policy — Claude follows these rules when deciding whether to call `knowledge_promote`.

**Evidence Tiers**:

| Tier | Source | What It Proves | Effect |
|------|--------|---------------|--------|
| Golden | Documentation (`docs/`, `CLAUDE.md`) | Knowledge is documented | Required for promotion |
| Golden | Code (`src/`, `lib/`) | Knowledge matches implementation | Required for promotion |
| Golden | Tests (`test/`, `scripts/`) | Knowledge is verified by tests | Required for promotion |
| Golden | Task tracking (Jira/beads issue) | Knowledge is tracked and reviewed | Required for promotion |
| Weak | User prompt/answer | User believes it's true | Confirm/refute only |
| Weak | LLM inference | Claude believes it's true | Confirm/refute only |
| Weak | Other sources | Unverified origin | Confirm/refute only |

**When to validate** (`knowledge_validate`):
- **Confirm** with `evidence` citing the source (e.g., `"Confirmed in src/config.ts:42"`)
- **Refute** with `evidence` explaining why it's wrong
- Weak evidence adjusts confidence via confirm/refute but cannot trigger promotion

**When to promote** (`knowledge_promote`):
- ALL 4 golden sources must be verified before calling `knowledge_promote`
- If any golden source is missing, ask the user to create it (e.g., "This knowledge has no test coverage — should I write a test?")
- Use the `reason` field to cite all 4 sources:
  ```
  Golden Evidence: [docs:docs/architecture.md] [code:src/engine/retriever.ts:55] [tests:scripts/regression-test.ts] [task:KG-42]
  ```

**Updated lifecycle with golden evidence gate**:

```
  hypothesis ──[confirm x3 + conf≥0.85]──> validated ──[golden evidence]──> promoted ──[conf≥0.9]──> canonical
       │                                                     │                   │                        │
       │                                        ALL 4 sources verified:          │                        │
       │                                        docs + code + tests + task       │                        │
       │                                                                         │                        │
       └────[refute + conf<0.2]─────────> refuted <──────────────────────────────┘────[refute + conf<0.2]─┘

  active ──[promote]──> promoted   (direct path for fact/rule/workflow chunks)
```

### Confidence Scoring (`engine/confidence.ts`)

**On confirmation** (diminishing returns):
```
decay_factor = 1 / (1 + 0.3 * validation_count)
new_confidence = min(1.0, old + boost * decay_factor)
```
Where `validation_count` is the count **before** the current action. With `boost: 0.25`: 1st confirm +0.25, 5th +0.11, 10th +0.07.

**On refutation** (amplifying impact):
```
amplify_factor = 1 + 0.1 * refutation_count
new_confidence = max(0.0, old - penalty * amplify_factor)
```

**Temporal decay** (computed at query/list time, NOT stored):
```
months_since = (now - last_validated_at) / 30_days
effective_confidence = confidence * decay_rate^months_since
```
Only applied when `last_validated_at` is set. Per-category decay rates:
- `fact`, `rule`: 1.0 (no decay)
- `insight`: 0.95/month
- `question`: 0.90/month
- `workflow`: 0.98/month

### Proactive Surfacing

When storing a new chunk (after dedup check, before chunk creation), the system searches top 5 candidates (hardcoded) via `vectorSearchUnfiltered(embedding, 5)` for similar validated/canonical/promoted chunks (similarity 0.6 to < dedup threshold, default 0.88) and returns them as `related_knowledge` with a `relation_hint` of `similar` (≥0.75) or `loosely_related` (<0.75).

### Access Tracking

Every query increments `access_count` for all returned chunks. This is tracked but not currently used in scoring — available for future utility-weighted ranking.

## Search Pipeline (Retriever — `engine/retriever.ts`)

1. Embed query → 2. Vector search (HNSW, 50 candidates, applies filters on raw confidence) → 3. Extract terms → 4. Graph expansion (depth 1 from top 3 hits) → 5. Merge & score (vector 0.55 + keyword 0.2 + graph 0.2/0.15 + confidence boost) → 6. Sort, filter refuted + post-filters (min_confidence on effective/decayed confidence), track access. Returns the full neighborhood — no result limit. Falls back to keyword-only if embedding fails.

**Score Weights**: vector 0.55 + keyword 0.2 + graph 0.2 (in vector results) or 0.15 (graph-only) + confidence boost (configurable, default weight 0.1).

**Confidence boost formula**: `(effective_confidence - 0.5) * confidenceSearchWeight`. Range: -0.05 (refuted) to +0.05 (canonical).

**Pipeline Parameters**:

| Parameter | Value | Location |
|---|---|---|
| Vector candidate pool (HNSW) | 50 | `retriever.ts` |
| Graph expansion sources | top 3 vector hits | `retriever.ts` |
| Graph traversal depth | 1 hop | `retriever.ts` |
| Score: vector weight | 0.55 | `retriever.ts` |
| Score: keyword weight | 0.2 | `retriever.ts` |
| Score: graph weight | 0.2 (in vector results), 0.15 (graph-only) | `retriever.ts` |
| Score: confidence weight | 0.1 | `config.ts` → `learning.confidenceSearchWeight` |

**Keyword Scoring** (`computeKeywordScore`):
- Exact match in keywords/entities/tags/domain: +0.3 per term
- Partial match (substring): +0.1 per term
- Capped at `Math.min(score, 1.0)`

### Auto-Linking (Linker — `engine/linker.ts`)

On store: creates `RELATES_TO` edges tagged `auto_created: 'true'` for chunks above similarity threshold. On evolve: deletes only auto-created edges, preserves manual links, re-runs auto-linking.

| Parameter | Value | Location |
|---|---|---|
| Auto-link similarity threshold | 0.82 | `config.ts` → `search.similarityThreshold` |
| Max auto-links per chunk | 5 | `config.ts` → `search.autoLinkTopK` |
| Suggested relation match threshold | 0.50 | `linker.ts` |

### Deduplication (`tools/store.ts`)

Before storing, the system checks for semantic duplicates:

| Parameter | Value | Location |
|---|---|---|
| Dedup similarity threshold | 0.88 | `config.ts` → `dedup.similarityThreshold` |

When a duplicate is detected (similarity >= 0.88), the store returns the existing chunk ID with `duplicate_of`, `similarity`, `existing_content`, `existing_summary`, and `action_hint` fields. No new chunk is created. The hint suggests using `knowledge_evolve` to merge new information into the existing chunk.

## Tools (8 total)

| Tool | Purpose |
|------|---------|
| `knowledge_store` | Store chunk with learning-aware defaults + proactive surfacing |
| `knowledge_query` | Confidence-boosted semantic search with lifecycle filters |
| `knowledge_list` | Browse with lifecycle/confidence/time filters, effective confidence |
| `knowledge_link` | Create chunk→chunk relationships |
| `knowledge_evolve` | Update content with confidence preservation |
| `knowledge_delete` | Delete chunk and all relations |
| `knowledge_validate` | Confirm or refute knowledge (drives lifecycle) |
| `knowledge_promote` | Graduate knowledge to higher lifecycle status |


### knowledge_validate

```typescript
// Input
{ id: string, action: 'confirm' | 'refute', evidence?: string, context?: string }
// Output (note: action returns past tense 'confirmed' | 'refuted')
{ id, action: 'confirmed' | 'refuted', confidence, validation_count, refutation_count, lifecycle, auto_promoted, promotion_details? }
```

Auto-promotes hypothesis → validated when `validation_count >= 3` AND `confidence >= 0.85`. Refuted when `confidence < 0.2`. Revives refuted → hypothesis when confirmed and `confidence >= 0.2`.

**Golden evidence**: Always include `evidence` citing the specific source. Weak evidence (user prompt, LLM inference) adjusts confidence but cannot trigger promotion. See [Validation Policy](#validation-policy-golden-evidence).

### knowledge_promote

```typescript
// Input
{ id: string, reason: string, new_category?: ChunkCategory, new_importance?: Importance }
// Output
{ id, previous_category, new_category, previous_lifecycle, new_lifecycle, confidence, reason }
```

Lifecycle transitions: hypothesis → validated → promoted → canonical (requires conf ≥ 0.9). Also supports `active` → `promoted` directly. Guards: cannot promote chunks with confidence < 0.2 (typically refuted), cannot promote low-confidence chunks (confidence < 0.5), cannot promote already-canonical chunks. Note: The promote handler has no case for `refuted` lifecycle. In practice, `knowledge_validate` always revives refuted chunks to `hypothesis` before confidence can reach the 0.5 promotion threshold.

**Golden evidence**: Requires ALL 4 golden evidence sources verified before calling. Use `reason` format: `Golden Evidence: [docs:path] [code:path:line] [tests:path] [task:issue-id]`. See [Validation Policy](#validation-policy-golden-evidence).

### knowledge_list (enhanced)

Returns `confidence`, `effective_confidence` (with temporal decay), `lifecycle`, `validation_count`, `access_count`, `last_validated_at`, `layer`. The `min_confidence` filter applies to **effective** (decayed) confidence, not raw stored value. Note: unlike `knowledge_query`, `knowledge_list` does NOT filter out refuted chunks by default.

### knowledge_evolve (enhanced)

Preserves confidence, validation_count, lifecycle, and other learning fields on content evolution. Always returns a `note` suggesting re-validation (unconditional). Archive chunks also copy all learning fields (confidence, validation_count, refutation_count, last_validated_at, lifecycle, access_count). Metadata provided to evolve is normalized using the same rules as store (domain→kebab-case, keywords→lowercased+deduplicated, tags→kebab-case+deduplicated, entities→deduplicated+filtered to 2+ chars). When category changes and no explicit layer is provided, the layer is automatically re-inferred from the new category. Zod constraints for evolve match store: domain max 50 chars, keywords 1–15 items with min 2 chars each, entities each min 2 chars. `source` is NOT available in evolve metadata.

## Metadata Schema

### Required Fields

| Field | Constraint | Purpose |
|---|---|---|
| `summary` | 1–200 chars | One-sentence description |
| `keywords` | 1–15 items, each 2+ chars | Search terms |
| `domain` | max 50 chars, free-form | Topic area (e.g., `"state-management"`) |
| `category` | `fact` \| `rule` \| `insight` \| `question` \| `workflow` | Drives layer inference + content size targets |
| `importance` | `critical` \| `high` \| `medium` \| `low` | Priority signal for retrieval |

### Optional Fields

| Field | Constraint | Purpose |
|---|---|---|
| `layer` | string, auto-inferred if omitted | `core-knowledge`, `learning`, `procedural`, or custom |
| `entities` | strings, filtered to 2+ chars, deduplicated | Named things (class names, tools) |
| `tags` | strings, normalized to kebab-case, deduplicated | Free-form labels |
| `source` | string, trimmed | Origin of the knowledge |
| `suggested_relations` | `{concept, relation}[]` | Hints for the linker — matched via domain (0.9), keyword (0.7), or embedding similarity (≥0.5), tried in order |

### Layer Auto-Inference

When `layer` is omitted, inferred from `category` in `store.ts:inferLayer()`:

- `fact`, `rule` → `core-knowledge`
- `insight`, `question` → `learning`
- `workflow` → `procedural`

### Normalization on Store

- **domain** → kebab-case (`"State Management"` → `"state-management"`, `"DI"` → `"di"`)
- **keywords** → lowercased + deduplicated
- **tags** → kebab-case (`My Tag` → `my-tag`) + deduplicated
- **entities** → deduplicated + filtered to length >= 2
- **source** → trimmed

### Domain Reuse Policy

Before storing a new chunk, Claude MUST check existing domains to avoid fragmentation:

1. Call `knowledge_list` (no filters, or filter by relevant category) to see existing domains
2. Reuse an existing domain if one matches the topic — do NOT invent a synonym (e.g., use `"dependency-injection"` if it already exists, not `"di"` or `"injection"`)
3. Only create a new domain when no existing domain covers the topic

Normalization catches case/format variants automatically (`"DI"` → `"di"`), but cannot catch semantic synonyms (`"di"` vs `"dependency-injection"`). That requires Claude's judgment.

### What's NOT Constrained

- **`domain`** — free-form string after kebab-case normalization. No controlled vocabulary. Semantic synonyms like `"di"` and `"dependency-injection"` are distinct — follow the Domain Reuse Policy above to prevent fragmentation.
- **`entities`** — not lowercased (unlike keywords), so `"ProductCubit"` and `"productcubit"` are distinct.
- **`suggested_relations.concept`** — free-text matched against existing chunks via domain match (0.9), keyword match (0.7), or embedding similarity (≥0.5), tried in order. Not exact match.

## Query Philosophy: Network, Not RAG

This is a knowledge network, not a RAG system. When Claude queries a topic, the goal is to return the full neighborhood of related knowledge — not just the top-N closest matches. The graph decides what's related through vector similarity, keyword matching, graph traversal, and confidence scoring. Everything connected comes back, sorted by relevance. Claude gets context, not snippets.

## Content Philosophy: Atomic Nodes

Each node should be small and focused — one idea, one fact, one rule. Think mind map, not wiki page. Content must be plain natural language — no markdown formatting inside nodes. The server warns when content exceeds category-specific size targets (fact: 500, rule: 800, insight: 600, question: 400, workflow: 800 chars). The Zod hard limit is 5000 chars (enforced in client.ts). Smaller nodes produce richer graphs with more edges and better search results.

## Configuration (`config.ts`)

File: `~/.knowledge-graph/knowledge.json` (created by `knowledge-graph setup`)

**Resolution priority** (highest wins): CLI flags → env vars → `knowledge.json` → hard defaults.

### Defaults

| Setting | Default | Env Override |
|---|---|---|
| Storage backend | `kuzu` | `KNOWLEDGE_STORAGE_BACKEND` |
| DB path | `~/.knowledge-graph/data/knowledge` | `KNOWLEDGE_DB_PATH` |
| Ollama URL | `http://localhost:11434` | `OLLAMA_URL` |
| Ollama model | `bge-m3` | `OLLAMA_MODEL` |
| Embedding cache size | `10,000` entries | — |
| Auto-link similarity threshold | `0.82` | — |
| Auto-link top-K | `5` | — |
| Dedup similarity threshold | `0.88` | — |

### Learning Configuration

| Setting | Default | Purpose |
|---|---|---|
| `autoPromoteConfidence` | 0.85 | Min confidence for auto-promotion |
| `autoPromoteValidations` | 3 | Min validations for auto-promotion |
| `confirmationBoost` | 0.25 | Base boost per confirmation (diminishing) |
| `refutationPenalty` | 0.15 | Base penalty per refutation (amplifying) |
| `confidenceSearchWeight` | 0.1 | Weight of confidence in search scoring |
| `hypothesisInitialConfidence` | 0.3 | Starting confidence for insights/questions |
| `decayRates.default` | 0.95 | Monthly decay rate (default) |
| `decayRates.fact` | 1.0 | No decay for facts |
| `decayRates.rule` | 1.0 | No decay for rules |
| `decayRates.insight` | 0.95 | 5% monthly decay |
| `decayRates.question` | 0.90 | 10% monthly decay |
| `decayRates.workflow` | 0.98 | 2% monthly decay |

### Project Configuration (`.knowledge-graph/config.json`)

| Setting | Default | Purpose |
|---|---|---|
| `daemon.port_range_start` | 0 (auto) | Starting port for daemon (0 = OS auto-assign) |
| `daemon.idle_timeout_ms` | 300000 (5 min) | Auto-shutdown when no clients connected |

## All System Constraints (Quick Reference)

| Constraint | Value | Source |
|---|---|---|
| Max content | 1–5000 chars (Zod hard limit in `client.ts`); per-category size warnings in `store.ts` | `client.ts` / `store.ts` |
| Max summary | 200 chars | `client.ts` zod |
| Keywords per chunk | 1–15, each 2+ chars | `client.ts` zod |
| Domain max length | 50 chars (no min — empty string passes) | `client.ts` zod |
| Embedding dimensions | 1024, fixed | `types.ts` |
| Proactive surfacing candidates | 5 (hardcoded) | `store.ts` |
| Dedup threshold | 0.88 | `config.ts` |
| Auto-link threshold | 0.82 | `config.ts` |
| Auto-link max per chunk | 5 | `config.ts` |
| Suggested relation threshold | 0.50 | `linker.ts` |
| Vector search candidates | 50 | `retriever.ts` |
| Graph expansion sources | top 3 hits | `retriever.ts` |
| Graph traversal depth | 1 hop | `retriever.ts` |
| Score: vector weight | 0.55 | `retriever.ts` |
| Score: keyword weight | 0.2 | `retriever.ts` |
| Score: graph weight | 0.2 (in vector results), 0.15 (graph-only) | `retriever.ts` |
| Score: confidence weight | 0.1 | `config.ts` |
| Keyword exact match boost | +0.3 | `retriever.ts` |
| Keyword partial match boost | +0.1 | `retriever.ts` |
| Keyword score cap | 1.0 | `retriever.ts` |
| Term min length (extraction) | 3 chars | `retriever.ts` |
| Keyword-only fallback terms | first 5 | `retriever.ts` |
| Embedding cache | 10,000 LRU | `config.ts` |
| List default limit | 50 | `daemon.ts` |

| Chunk→Chunk relation types | 15 | `types.ts` |
| Confirmation boost | 0.25 (diminishing) | `config.ts` |
| Refutation penalty | 0.15 (amplifying) | `config.ts` |
| Auto-promote threshold | conf ≥ 0.85, validations ≥ 3 | `config.ts` |
| Refuted threshold | conf < 0.2 | hardcoded |
| Hypothesis initial confidence | 0.3 | `config.ts` |
| Daemon idle timeout | 300s (5 min) | `project.ts` default |
| Daemon startup timeout | 15s | `daemon-manager.ts` |

### Storage Backends

Both backends implement the `IStorage` interface (`storage/interface.ts`). Backend selection: `--storage <kuzu|surreal>` or `KNOWLEDGE_STORAGE_BACKEND` env var or `storage.backend` in config.

#### KuzuDB (`storage/kuzu.ts`) — Default

- **Embedding dimensions**: fixed at 1024 (`EMBEDDING_DIMENSIONS` in `types.ts`). Cast as `DOUBLE[1024]` in all create operations. Changing requires full DB migration.
- **Vector index**: HNSW with cosine metric.
- **Cannot SET vector-indexed columns**: `updateChunk()` works around this by saving relations → deleting node → re-creating with new embedding → restoring all relations.
- **Primary keys**: `Chunk.id` (STRING) — must be unique.
- **Chunk defaults**: `layer` defaults to `'core-knowledge'`, `version` starts at 1, timestamps auto-set.
- **Learning columns**: Added via ALTER TABLE migrations — `confidence`, `validation_count`, `refutation_count`, `last_validated_at`, `lifecycle`, `access_count`.

#### SurrealDB (`storage/surreal.ts`) — Opt-in

- **Embedded mode**: Uses `@surrealdb/node` with `surrealkv://` protocol. No external server needed.
- **Namespace/database**: `knowledge` / `graph`.
- **Schema**: SCHEMAFULL `chunk` table with all 24 fields. `embedding` field is `array<float>`.
- **Vector index**: HNSW with COSINE distance, 1024 dimensions (same as KuzuDB).
- **No vector-indexed column limitation**: `updateChunk()` uses direct `UPDATE` — no workaround needed.
- **Record IDs**: SurrealDB returns `RecordId` objects (`chunk:uuid`). `extractId()` helper strips the table prefix.
- **Reserved words**: `REQUIRES` is reserved in SurrealDB — mapped to `requires_rel` table internally.
- **Relation tables**: 15 TYPE RELATION tables (FROM chunk TO chunk), mapped via `SURREAL_REL_TABLE`.
- **KNN syntax**: `embedding <|K, COSINE|> $vec` with `vector::distance::knn()` for distance.

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point — command dispatch, config resolution, project detection |
| `src/core.ts` | Creates and wires all engine components (used by daemon) |
| `src/daemon.ts` | Daemon process — HTTP server, DB lock owner, dashboard host |
| `src/daemon-manager.ts` | Ensures daemon is running, spawns new one if needed |
| `src/client.ts` | MCP stdio-to-HTTP proxy (forwards tool calls to daemon) |
| `src/project.ts` | Per-project `.knowledge-graph/` management, discovery, registry |
| `src/rpc.ts` | JSON-RPC 2.0 request/response utilities |
| `src/types.ts` | All shared types, relation maps, constants |
| `src/config.ts` | Config loading, defaults, env/CLI override resolution |
| `src/storage/interface.ts` | IStorage abstraction + `createStorage()` backend factory |
| `src/storage/kuzu.ts` | KuzuDB storage backend — CRUD, vector search, schema migrations |
| `src/storage/surreal.ts` | SurrealDB storage backend — embedded mode, SCHEMAFULL tables |
| `src/engine/embedder.ts` | Ollama embeddings with SHA256-keyed LRU cache |
| `src/engine/retriever.ts` | Hybrid search pipeline: vector + keyword + graph + confidence |
| `src/engine/linker.ts` | Auto-linking + suggested relation matching |
| `src/engine/confidence.ts` | Confidence scoring formulas + temporal decay |
| `src/tools/store.ts` | Store handler — dedup, learning defaults, proactive surfacing |
| `src/tools/query.ts` | Query handler — delegates to retriever |
| `src/tools/list.ts` | List handler — effective confidence with decay |
| `src/tools/evolve.ts` | Evolve handler — content update with confidence preservation |
| `src/tools/validate.ts` | Validate handler — confirm/refute lifecycle state machine |
| `src/tools/promote.ts` | Promote handler — lifecycle graduation |
| `src/tools/link.ts` | Link handler — create chunk→chunk edges |
| `src/tools/delete.ts` | Delete handler — remove chunk + all edges |

| `src/dashboard/server.ts` | Dashboard HTTP server + SSE event streaming |
| `src/dashboard/events.ts` | EventBus for pipeline step events |
| `src/dashboard/api.ts` | Dashboard REST API (stats, graph, chunks) |
| `src/dashboard/index.html` | Dashboard SPA (graph viz, event timeline, detail panel) |
| `scripts/regression-test.ts` | 19-test regression suite covering all features |

## Documentation Consistency

After any code change, run the `sync-docs` skill (`.claude/skills/sync-docs/SKILL.md`) to keep `CLAUDE.md`, `docs/`, and code in sync. The skill defines what to check and which files to update for each type of change. See `.claude/skills/sync-docs/references/doc-map.md` for the full change-to-file matrix.
