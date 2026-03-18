# How Claude Interacts with the Knowledge Graph

This document explains the full interaction flow between Claude Code and the
knowledge-graph MCP server, using ASCII diagrams.

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Project Discovery](#project-discovery)
3. [Project Mode (Daemon)](#project-mode-daemon)
4. [Tool Call Lifecycle](#tool-call-lifecycle)
5. [Store Flow](#store-flow)
6. [Query Flow (Search Pipeline)](#query-flow-search-pipeline)
7. [SSE & Dashboard Integration](#sse--dashboard-integration)
8. [Daemon Lifecycle](#daemon-lifecycle)
9. [Multi-Session Sharing](#multi-session-sharing)
10. [Shutdown Behavior](#shutdown-behavior)
11. [Knowledge Lifecycle](#knowledge-lifecycle-confidence--validation)
12. [Validation Policy (Golden Evidence)](#validation-policy-golden-evidence)
13. [Domain Reuse Policy](#domain-reuse-policy)
14. [Complete Request Paths](#complete-request-paths-end-to-end)

---

## High-Level Architecture

Claude Code communicates with the knowledge-graph via the MCP (Model Context
Protocol). The system requires a `.knowledge-graph/` directory (created by
`kg init`). A background daemon owns the database and serves tool calls.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                         Claude Code (LLM)                          │
 │                                                                    │
 │  "I need to store/query knowledge"                                 │
 │       │                                                            │
 │       ▼                                                            │
 │  MCP Tool Call (JSON-RPC over stdin/stdout)                        │
 └───────┬────────────────────────────────────────────────────────────┘
         │
         ▼
 ┌───────────────────┐     .knowledge-graph/     ┌───────────────────┐
 │                   │     found in parent?       │                   │
 │    cli.ts serve   │─────────────────────────── │ Project Discovery │
 │                   │                            │                   │
 └───────┬───────────┘                            └───────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  YES        NO
    │         │
    ▼         ▼
 DAEMON    ERROR
  MODE     (exit 1)
           "Run kg init"
```

---

## Project Discovery

When `cli.ts serve` starts, it checks the current working directory for
`.knowledge-graph/config.json`. It does NOT walk up the directory tree. If not
found, the server exits with an error.

```
  Current Working Directory
         │
         ▼
  ┌──────────────────────────────┐
  │ discoverProject(cwd)         │
  │                              │
  │  cwd/                        │
  │   └── .knowledge-graph/      │◄── check here only
  │        └── config.json       │
  └──────────┬───────────────────┘
             │
        ┌────┴────┐
        │         │
      FOUND    NOT FOUND
        │         │
        ▼         ▼
    Daemon     Error + exit
     Mode      "Run kg init"
```

---

## Project Mode (Daemon)

The preferred mode. A background daemon owns the database. The MCP client
is a thin proxy that forwards tool calls over HTTP.

```
 ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
 │              │  stdio   │              │  HTTP     │              │
 │  Claude Code │◄────────►│  client.ts   │◄────────►│  daemon.ts   │
 │              │  MCP     │  (MCP proxy) │  JSON-RPC │  (DB owner)  │
 └──────────────┘          └──────────────┘  POST/rpc └──────┬───────┘
                                                             │
                                             ┌───────────────┼───────────────┐
                                             │               │               │
                                             ▼               ▼               ▼
                                      ┌───────────┐  ┌────────────┐  ┌────────────┐
                                      │  KuzuDB   │  │  Ollama    │  │ Dashboard  │
                                      │  (graph)  │  │  (embed)   │  │ (HTTP+SSE) │
                                      └───────────┘  └────────────┘  └────────────┘

 Files written by daemon:
 ┌─────────────────────────────┐
 │ .knowledge-graph/           │
 │   ├── config.json           │  ◄── project identity + settings
 │   ├── daemon.port           │  ◄── running daemon's port (gitignored)
 │   ├── daemon.pid            │  ◄── running daemon's PID  (gitignored)
 │   └── data/knowledge/       │  ◄── KuzuDB database files (gitignored)
 └─────────────────────────────┘
```

---

## Tool Call Lifecycle

A single tool call flows through 4 layers.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Layer 1: MCP Transport                                             │
 │                                                                    │
 │  Claude ──stdin──► { jsonrpc: "2.0", method: "knowledge_store" }   │
 │                                                                    │
 │  ┌──────────────────────────────────────────────────────────────┐   │
 │  │ Layer 2: Tool Handler                                        │   │
 │  │                                                              │   │
 │  │  handleStore(storage, embedder, linker, params, onStep)      │   │
 │  │                                                              │   │
 │  │  ┌──────────────────────────────────────────────────────┐    │   │
 │  │  │ Layer 3: Engine                                       │    │   │
 │  │  │                                                      │    │   │
 │  │  │  embedder.embed()    → Ollama API                    │    │   │
 │  │  │  retriever.search()  → hybrid search pipeline        │    │   │
 │  │  │  linker.autoLink()   → similarity-based edge creation│    │   │
 │  │  │                                                      │    │   │
 │  │  │  ┌──────────────────────────────────────────────┐    │    │   │
 │  │  │  │ Layer 4: Storage                              │    │    │   │
 │  │  │  │                                              │    │    │   │
 │  │  │  │  KuzuDB: CRUD, vector search (HNSW),        │    │    │   │
 │  │  │  │          graph traversal, schema migrations  │    │    │   │
 │  │  │  └──────────────────────────────────────────────┘    │    │   │
 │  │  └──────────────────────────────────────────────────────┘    │   │
 │  └──────────────────────────────────────────────────────────────┘   │
 │                                                                    │
 │  Claude ◄──stdout── { jsonrpc: "2.0", result: { id: "abc-123" } }  │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## Store Flow

What happens when Claude calls `knowledge_store`.

```
 Claude: knowledge_store({ content: "...", metadata: {...} })
         │
         ▼
 ┌───────────────────────────────────────────────────────────────────┐
 │ handleStore()                                                     │
 │                                                                   │
 │  1. EMBED                                                         │
 │     content ──► Ollama bge-m3 ──► 1024-dim vector                │
 │                                      │                            │
 │  2. DEDUP CHECK                      ▼                            │
 │     vector search (top 1) ──► similarity ≥ 0.88?                 │
 │                                  │          │                     │
 │                                 YES        NO                     │
 │                                  │          │                     │
 │                                  ▼          ▼                     │
 │                             Return    3. PROACTIVE SURFACE        │
 │                             duplicate      │                      │
 │                             warning        ▼                      │
 │                                    find validated/canonical/      │
 │                                    promoted chunks                │
 │                                    (sim 0.60–0.88)               │
 │                                             │                     │
 │                                    4. NORMALIZE + DEFAULTS        │
 │                                             │                     │
 │                                             ▼                     │
 │                                    kebab-case domain/tags,        │
 │                                    dedup keywords/entities,       │
 │                                    infer layer from category,     │
 │                                    set confidence/lifecycle       │
 │                                             │                     │
 │                                        5. STORE                   │
 │                                             │                     │
 │                                             ▼                     │
 │                                        createChunk()              │
 │                                        in KuzuDB                  │
 │                                             │                     │
 │                                        6. AUTO-LINK               │
 │                                             │                     │
 │                                             ▼                     │
 │                                    vector search (top K+1,        │
 │                                    excl. self)                    │
 │                                    similarity ≥ 0.82              │
 │                                             │                     │
 │                                             ▼                     │
 │                                    create RELATES_TO edges        │
 │                                    (auto_created: true)           │
 │                                             │                     │
 │                                             ▼                     │
 │                                    Return: {                      │
 │                                      id,                          │
 │                                      auto_links: [...],           │
 │                                      related_knowledge: [...]     │
 │                                    }                              │
 └───────────────────────────────────────────────────────────────────┘
```

---

## Query Flow (Search Pipeline)

What happens when Claude calls `knowledge_query`.

```
 Claude: knowledge_query({ query: "state management", filters: {...} })
         │
         ▼
 ┌───────────────────────────────────────────────────────────────────┐
 │ retriever.search()                                                │
 │                                                                   │
 │  1. EMBED QUERY                                                   │
 │     "state management" ──► Ollama ──► 1024-dim vector            │
 │                                          │                        │
 │  2. VECTOR SEARCH (HNSW)                 ▼                        │
 │     KuzuDB cosine search ──► 50 candidates                       │
 │                                          │                        │
 │  3. KEYWORD BOOST                        ▼                        │
 │     extract terms (3+ chars)                                      │
 │     ┌─────────────────────────────────────────────┐               │
 │     │  for each candidate:                         │               │
 │     │    exact match in keywords/       → +0.30     │               │
 │     │      entities/tags/domain                    │               │
 │     │    partial match (substring)     → +0.10     │               │
 │     │    cap at 1.0                                │               │
 │     └─────────────────────────────────────────────┘               │
 │                                          │                        │
 │  4. GRAPH EXPANSION                      ▼                        │
 │     top 3 vector hits ──► follow all edges (depth 1)             │
 │     add neighbor nodes to candidate pool                          │
 │                                          │                        │
 │  5. SCORE MERGE                          ▼                        │
 │     ┌──────────────────────────────────────────┐                  │
 │     │  final_score =                            │                  │
 │     │    vector_similarity     × 0.55           │                  │
 │     │  + keyword_score         × 0.20           │                  │
 │     │  + graph_bonus            0.20 (vector+graph) or 0.15 (graph-only) │
 │     │  + confidence_boost  (added directly)     │                  │
 │     └──────────────────────────────────────────┘                  │
 │                                          │                        │
 │  6. CONFIDENCE BOOST (with temporal decay)                        │
 │     ┌──────────────────────────────────────────┐                  │
 │     │  months = (now - last_validated) / 30d    │                  │
 │     │  effective = confidence × decay^months    │                  │
 │     │  boost = (effective - 0.5) × 0.10         │                  │
 │     │  (weight is embedded in the formula,      │                  │
 │     │   result added directly to final_score)   │                  │
 │     │                                           │                  │
 │     │  Decay rates by category:                 │                  │
 │     │    fact, rule    → 1.00 (no decay)        │                  │
 │     │    workflow      → 0.98/month             │                  │
 │     │    insight       → 0.95/month             │                  │
 │     │    question      → 0.90/month             │                  │
 │     └──────────────────────────────────────────┘                  │
 │                                          │                        │
 │  7. FILTER                               ▼                        │
 │     - exclude lifecycle=refuted (unless explicitly requested)     │
 │     - apply min_confidence, lifecycle, since filters              │
 │                                          │                        │
 │  8. TRACK ACCESS                         ▼                        │
 │     increment access_count for all returned chunks                │
 │                                          │                        │
 │  9. RETURN                               ▼                        │
 │     { chunks: [{ id, content, score, metadata }], total: N }     │
 └───────────────────────────────────────────────────────────────────┘
```

---

## SSE & Dashboard Integration

Every tool call emits step events in real-time to the dashboard.

```
 Tool Handler                    EventBus              Dashboard (Browser)
      │                             │                        │
      │  onStep('embedding', ...)   │                        │
      ├────────────────────────────►│                        │
      │                             │   SSE: data: {...}     │
      │                             ├───────────────────────►│
      │                             │                        │  render step card
      │                             │                        │  highlight nodes
      │  onStep('vector_search')    │                        │
      ├────────────────────────────►│                        │
      │                             │   SSE: data: {...}     │
      │                             ├───────────────────────►│
      │                             │                        │  show score bars
      │                             │                        │
      │  onStep('complete', ...)    │                        │
      ├────────────────────────────►│                        │
      │                             │   SSE: data: {...}     │
      │                             ├───────────────────────►│
      │                             │                        │  show duration
      │                             │                        │  refreshGraph()
      │                             │                        │  refreshStats()

 Dashboard HTTP Routes:
 ┌──────────────────────────────────────────────────────────┐
 │  GET  /              → Dashboard SPA (index.html)        │
 │  GET  /api/events    → SSE subscription (EventSource)    │
 │  GET  /api/graph     → Chunk nodes + relation edges for D3 force graph │
 │  GET  /api/stats     → Chunk/edge counts, cache stats    │
 │  GET  /api/chunks/:id→ Single chunk detail               │
 │  GET  /api/search    → Semantic search from dashboard    │
 │  GET  /api/health    → Health check + SSE client count   │
 │  GET  /api/recent    → Recent events (backfill on load)  │
 │  POST /api/trigger/:name → Execute tool handler from dashboard │
 └──────────────────────────────────────────────────────────────────┘
```

Dashboard HTTP and SSE endpoints accept browser origins only from `127.0.0.1`, `localhost`, or `::1`. `POST /api/trigger/:name` also uses the shared 1 MB request-body limit from `src/http-utils.ts`.

---

## Daemon Lifecycle

How the daemon is started, discovered, and managed.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ ensureDaemon() — called by cli.ts during serve/serve-standalone    │
 │                                                                    │
 │  Step 1: Check daemon.port file                                    │
 │  ┌─────────────────────────────────────────────────────┐           │
 │  │  .knowledge-graph/daemon.port exists?                │           │
 │  │       │              │                               │           │
 │  │      YES            NO ──────────────► go to Step 2  │           │
 │  │       │                                              │           │
 │  │       ▼                                              │           │
 │  │  GET /health ──► responds?                           │           │
 │  │       │              │                               │           │
 │  │      YES            NO                               │           │
 │  │       │              │                               │           │
 │  │       ▼              ▼                               │           │
 │  │  REUSE daemon   clean up stale files                 │           │
 │  │  (return URL)   go to Step 2                         │           │
 │  └─────────────────────────────────────────────────────┘           │
 │                                                                    │
 │  Step 2: Check daemon.pid file                                     │
 │  ┌─────────────────────────────────────────────────────┐           │
 │  │  .knowledge-graph/daemon.pid exists?                 │           │
 │  │       │              │                               │           │
 │  │      YES            NO ──────────────► go to Step 3  │           │
 │  │       │                                              │           │
 │  │       ▼                                              │           │
 │  │  process alive? (signal 0)                           │           │
 │  │       │              │                               │           │
 │  │      YES            NO                               │           │
 │  │       │              │                               │           │
 │  │       ▼              ▼                               │           │
 │  │  fall through    clean up stale files                │           │
 │  │  to Step 3       go to Step 3                        │           │
 │  └─────────────────────────────────────────────────────┘           │
 │                                                                    │
 │  Step 3: Spawn new daemon                                          │
 │  ┌─────────────────────────────────────────────────────┐           │
 │  │  fork(daemon.ts, { detached: true })                 │           │
 │  │       │                                              │           │
 │  │       ▼                                              │           │
 │  │  env vars passed:                                    │           │
 │  │    KG_DAEMON_CONFIG   = JSON config                  │           │
 │  │    KG_PROJECT_DIR     = .knowledge-graph/ path       │           │
 │  │    KG_PROJECT_ID      = UUID                         │           │
 │  │    KG_IDLE_TIMEOUT_MS = 300000                       │           │
 │  │    KG_PORT_RANGE_START= 0 (auto-assign)             │           │
 │  │       │                                              │           │
 │  │       ▼                                              │           │
 │  │  poll daemon.port file every 100ms                   │           │
 │  │  timeout: 15 seconds                                 │           │
 │  │       │                                              │           │
 │  │       ▼                                              │           │
 │  │  daemon.port appears ──► return URL                  │           │
 │  └─────────────────────────────────────────────────────┘           │
 └─────────────────────────────────────────────────────────────────────┘

 Daemon initialization (inside daemon.ts):
 ┌─────────────────────────────────────────────────────────────────────┐
 │  1. Parse env vars (KG_DAEMON_CONFIG, KG_PROJECT_DIR, ...)         │
 │  2. createCore(config) → storage, embedder, retriever, linker      │
 │  3. Initialize KuzuDB (run schema migrations)                      │
 │  4. Start shared HTTP server for RPC + dashboard on 127.0.0.1      │
 │  5. Apply localhost-only origin checks and 1 MB POST body limit    │
 │  6. Write daemon.port and daemon.pid files                         │
 │  7. Start idle timer (300s default)                                │
 │  8. Ready: accept /rpc POST requests + dashboard traffic           │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Session Sharing

Multiple Claude Code sessions can share the same daemon.

```
 ┌──────────────┐
 │ Claude Code  │──── client.ts ───► /rpc/connect ──┐
 │  Session 1   │                                    │
 └──────────────┘                                    │
                                                     ▼
 ┌──────────────┐                           ┌──────────────┐
 │ Claude Code  │──── client.ts ───► /rpc/  │              │
 │  Session 2   │                    connect │  daemon.ts   │
 └──────────────┘                       │   │              │
                                        │   │ clientCount=3│
 ┌──────────────┐                       │   │              │
 │ Claude Code  │──── client.ts ────────┘   │ idle timer   │
 │  Session 3   │         /rpc/connect      │ paused while │
 └──────────────┘                           │ clients > 0  │
                                            └──────────────┘

 Refcount tracking:
   /rpc/connect    → clientCount++, pause idle timer
   /rpc/disconnect → clientCount--, start idle timer if count == 0
   idle timeout    → daemon shuts down (300s default)
```

---

## Shutdown Behavior

Different exit scenarios produce different behaviors.

```
 Scenario 1: User presses Ctrl+C in Claude Code terminal
 ┌──────────────────────────────────────────────────────┐
 │  SIGINT received by client.ts                        │
 │       │                                              │
 │       ▼                                              │
 │  POST /rpc/shutdown ──► daemon terminates            │
 │                         (cleans up port/pid files)   │
 └──────────────────────────────────────────────────────┘

 Scenario 2: Claude Code session ends normally
 ┌──────────────────────────────────────────────────────┐
 │  SIGTERM received by client.ts                       │
 │       │                                              │
 │       ▼                                              │
 │  POST /rpc/disconnect ──► clientCount--              │
 │                                                      │
 │  Daemon CONTINUES running for other sessions         │
 │  (shuts down after idle timeout if no clients left)  │
 └──────────────────────────────────────────────────────┘

 Scenario 3: All clients disconnect, idle timeout expires
 ┌──────────────────────────────────────────────────────┐
 │  clientCount reaches 0                               │
 │       │                                              │
 │       ▼                                              │
 │  idle timer starts (300s)                            │
 │       │                                              │
 │       ▼ (no new connections)                         │
 │  daemon self-terminates                              │
 │  cleanup: remove daemon.port, daemon.pid             │
 └──────────────────────────────────────────────────────┘

 Scenario 4: New client connects during idle countdown
 ┌──────────────────────────────────────────────────────┐
 │  idle timer running (e.g. 120s remaining)            │
 │       │                                              │
 │       ▼                                              │
 │  POST /rpc/connect ──► clientCount++                 │
 │                         idle timer cancelled         │
 │                         daemon stays alive           │
 └──────────────────────────────────────────────────────┘
```

---

## Knowledge Lifecycle (Confidence & Validation)

How knowledge chunks evolve over time through Claude's interactions.

```
                         confirm (x3, conf ≥ 0.85)
    ┌──────────┐       ┌──────────────┐  golden   ┌───────────┐
    │hypothesis│──────►│  validated   │─evidence─►│  promoted  │
    │ conf=0.3 │       │  conf≥0.85   │  gate     │            │
    └────┬─────┘       └──────────────┘           └─────┬──────┘
         │                                          │
         │              refute                      │ conf ≥ 0.9
         │           (conf < 0.2)                   │
         │                │                         ▼
         │                ▼                   ┌───────────┐
         │          ┌──────────┐              │ canonical │
         └─────────►│ refuted  │◄─────────────│ conf≥0.9  │
         refute     │ conf<0.2 │  refute      └───────────┘
                    └────┬─────┘
                         │
                         │ confirm (conf ≥ 0.2)
                         ▼
                    ┌──────────┐
                    │hypothesis│  (revived)
                    └──────────┘

    ┌──────────┐       promote        ┌───────────┐
    │  active  │─────────────────────►│  promoted  │
    │ conf=0.5 │  (direct path for    │            │
    └──────────┘   fact/rule/workflow) └────────────┘

 Category defaults:
 ┌─────────────────────────────────────────────┐
 │  fact, rule, workflow → lifecycle: active    │
 │                         confidence: 0.5      │
 │                                              │
 │  insight, question    → lifecycle: hypothesis│
 │                         confidence: 0.3      │
 └─────────────────────────────────────────────┘

 Confirmation formula (diminishing returns):
   decay = 1 / (1 + 0.3 × validation_count)
   new_conf = min(1.0, old + 0.25 × decay)

 Refutation formula (amplifying impact):
   amplify = 1 + 0.1 × refutation_count
   new_conf = max(0.0, old - 0.15 × amplify)
```

---

## Validation Policy (Golden Evidence)

Before promoting knowledge (`validated` → `promoted`), Claude must verify
ALL 4 golden evidence sources. This is a behavioral quality gate.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Golden Evidence Check (before knowledge_promote)                    │
 │                                                                    │
 │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────┐│
 │  │ 1. Docs      │  │ 2. Code      │  │ 3. Tests     │  │4. Task ││
 │  │              │  │              │  │              │  │        ││
 │  │ docs/ or     │  │ src/ or      │  │ test/ or     │  │ Jira / ││
 │  │ CLAUDE.md    │  │ lib/         │  │ scripts/     │  │ beads  ││
 │  │ confirms it? │  │ proves it?   │  │ verifies it? │  │tracks? ││
 │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └───┬────┘│
 │         │                 │                 │               │     │
 │         ▼                 ▼                 ▼               ▼     │
 │     ┌────────────────────────────────────────────────────────┐    │
 │     │                  ALL 4 verified?                        │    │
 │     │         │                        │                     │    │
 │     │        YES                      NO                     │    │
 │     │         │                        │                     │    │
 │     │         ▼                        ▼                     │    │
 │     │   knowledge_promote()     Ask user to create           │    │
 │     │   reason: "Golden         missing evidence             │    │
 │     │    Evidence: [docs:...]   (write test, file issue,     │    │
 │     │    [code:...] [tests:...] update docs)                 │    │
 │     │    [task:...]"                                         │    │
 │     └────────────────────────────────────────────────────────┘    │
 └─────────────────────────────────────────────────────────────────────┘
```

Evidence tiers:

```
 ┌─────────────────────────────────────────────────────────────┐
 │                     Evidence Tiers                           │
 │                                                             │
 │  GOLDEN (required for promotion)     WEAK (confidence only) │
 │  ┌─────────────────────────────┐    ┌─────────────────────┐ │
 │  │  Documentation              │    │  User prompt/answer  │ │
 │  │  Code                       │    │  LLM inference       │ │
 │  │  Tests                      │    │  Other sources       │ │
 │  │  Task tracking              │    │                      │ │
 │  │                             │    │  Can confirm/refute  │ │
 │  │  Can confirm/refute         │    │  CANNOT promote      │ │
 │  │  CAN promote (all 4 needed) │    │                      │ │
 │  └─────────────────────────────┘    └─────────────────────┘ │
 └─────────────────────────────────────────────────────────────┘
```

---

## Domain Reuse Policy

The `domain` field is free-form text (normalized to kebab-case by the server).
The server catches format variants (`"DI"` → `"di"`, `"State Management"` → `"state-management"`),
but cannot catch semantic synonyms (`"di"` vs `"dependency-injection"`). Claude must
check existing domains before storing to prevent fragmentation.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Before knowledge_store: Domain Selection Flow                       │
 │                                                                    │
 │  ┌──────────────────────────────────────────────┐                  │
 │  │ 1. Call knowledge_list (no filters, limit 50) │                  │
 │  │    → inspect returned domains                 │                  │
 │  └──────────────────┬───────────────────────────┘                  │
 │                     │                                              │
 │                     ▼                                              │
 │  ┌──────────────────────────────────────────────┐                  │
 │  │ 2. Does an existing domain cover this topic? │                  │
 │  │         │                        │           │                  │
 │  │        YES                      NO           │                  │
 │  │         │                        │           │                  │
 │  │         ▼                        ▼           │                  │
 │  │   Reuse that domain       Create new domain  │                  │
 │  │                                              │                  │
 │  │   "dependency-injection"   Only if no existing│                  │
 │  │   already exists?          domain covers the  │                  │
 │  │   → use it, don't          topic at all       │                  │
 │  │     create "di"                               │                  │
 │  └──────────────────────────────────────────────┘                  │
 │                                                                    │
 │  Server auto-normalization (transparent to Claude):                │
 │  ┌──────────────────────────────────────────────┐                  │
 │  │ "State Management" → "state-management"       │                  │
 │  │ "DI"               → "di"                     │                  │
 │  │ "My Domain"        → "my-domain"               │                  │
 │  └──────────────────────────────────────────────┘                  │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## Complete Request Paths (End to End)

All tool calls follow the same transport path: Claude → client.ts (stdio MCP) →
daemon.ts (HTTP JSON-RPC) → handler → components → response back up the chain.
Below are the internal flows for each major tool.

### knowledge_store

Store a single knowledge chunk. Embeds content via Ollama, checks for semantic
duplicates (>= 0.88 similarity), creates the node in KuzuDB, auto-links to
similar chunks (>= 0.82 similarity), and surfaces related validated/canonical
chunks (0.60-0.88 similarity) as proactive suggestions.

```
 ┌──────────┐    ┌───────────┐    ┌───────────┐    ┌─────────────────┐
 │  Claude   │    │ client.ts │    │ daemon.ts │    │   Components    │
 │  Code     │    │ (proxy)   │    │ (server)  │    │                 │
 └─────┬────┘    └─────┬─────┘    └─────┬─────┘    └────────┬────────┘
       │               │               │                    │
       │  MCP tool call│               │                    │
       │  (stdin)      │               │                    │
       ├──────────────►│               │                    │
       │               │               │                    │
       │               │  POST /rpc    │                    │
       │               │  JSON-RPC     │                    │
       │               ├──────────────►│                    │
       │               │               │                    │
       │               │               │  handleStore()     │
       │               │               ├───────────────────►│
       │               │               │                    │
       │               │               │  1. embed()        │
       │               │               │◄───────────────────┤──► Ollama
       │               │               │                    │
       │               │               │  SSE: embedding    │
       │               │               │────────────────────┼──► Dashboard
       │               │               │                    │
       │               │               │  2. dedup check    │
       │               │               │◄───────────────────┤──► KuzuDB
       │               │               │                    │
       │               │               │  3. proactive      │
       │               │               │     surface        │
       │               │               │◄───────────────────┤──► KuzuDB
       │               │               │  (find validated/  │
       │               │               │   canonical/promoted│
       │               │               │   sim 0.60-0.88)   │
       │               │               │                    │
       │               │               │  4. createChunk()  │
       │               │               │◄───────────────────┤──► KuzuDB
       │               │               │                    │
       │               │               │  SSE: stored       │
       │               │               │────────────────────┼──► Dashboard
       │               │               │                    │
       │               │               │  5. autoLink()     │
       │               │               │◄───────────────────┤──► KuzuDB
       │               │               │                    │
       │               │               │  SSE: complete     │
       │               │               │────────────────────┼──► Dashboard
       │               │               │                    │
       │               │  HTTP 200     │                    │
       │               │  JSON-RPC     │                    │
       │               │◄──────────────┤                    │
       │               │               │                    │
       │  MCP response │               │                    │
       │  (stdout)     │               │                    │
       │◄──────────────┤               │                    │
       │               │               │                    │
       ▼               ▼               ▼                    ▼
   Claude uses      proxy done     daemon idle       dashboard shows
   the result                      (awaiting next)   animated pipeline
```

---

### knowledge_query

Hybrid search across the knowledge graph. Embeds the query, runs HNSW vector
search (50 candidates), boosts by keyword matches, expands via graph traversal
(depth 1 from top 3 hits), merges scores with configurable weights, applies
confidence boost with temporal decay, filters out refuted chunks, and tracks
access counts. Returns the full neighborhood, not just top-N.

```
 ┌──────────┐    ┌───────────┐    ┌──────────────────────────────────────────┐
 │  Claude   │    │ client.ts │    │  daemon.ts → retriever.search()          │
 └─────┬────┘    └─────┬─────┘    └──────────────────┬───────────────────────┘
       │               │                             │
       │  knowledge_   │                             │
       │  query()      │  POST /rpc                  │
       ├──────────────►├────────────────────────────►│
       │               │                             │
       │               │           1. embed query    │──► Ollama
       │               │                             │
       │               │           2. vector search  │──► KuzuDB (HNSW, 50 candidates)
       │               │                             │
       │               │           3. keyword boost  │
       │               │              exact +0.30    │
       │               │              partial +0.10  │
       │               │                             │
       │               │           4. graph expand   │──► KuzuDB (depth 1 from top 3)
       │               │                             │
       │               │           5. score merge    │
       │               │              vector  × 0.55 │
       │               │              keyword × 0.20 │
       │               │              graph   × 0.20 │
       │               │              (conf-0.5)× 0.10 │
       │               │                             │
       │               │           6. conf boost     │
       │               │              temporal decay  │
       │               │                             │
       │               │           7. filter refuted │
       │               │              apply filters  │
       │               │                             │
       │               │           8. track access   │──► KuzuDB (access_count++)
       │               │                             │
       │               │◄───────────────────────────│
       │  { chunks[],  │                             │
       │    total }    │                             │
       │◄──────────────┤                             │
       ▼               ▼                             ▼
```

---

### knowledge_evolve

Update an existing chunk with new content. Archives the old version as a
separate low-importance chunk, creates a SUPERSEDES edge, re-embeds the new
content via Ollama, bumps the version number, and re-runs auto-linking.
Preserves all learning fields (confidence, validation counts, lifecycle) so
the chunk's trust history survives content updates.

```
 ┌──────────┐    ┌───────────┐    ┌──────────────────────────────────────────┐
 │  Claude   │    │ client.ts │    │  daemon.ts → handleEvolve()              │
 └─────┬────┘    └─────┬─────┘    └──────────────────┬───────────────────────┘
       │               │                             │
       │  knowledge_   │                             │
       │  evolve()     │  POST /rpc                  │
       ├──────────────►├────────────────────────────►│
       │               │                             │
       │               │           1. getChunk(id)   │──► KuzuDB
       │               │                             │
       │               │           2. archive old    │
       │               │              createChunk    │──► KuzuDB (archive-{uuid})
       │               │              (importance:low│
       │               │               tags:archived)│
       │               │                             │
       │               │           3. SUPERSEDES     │──► KuzuDB (edge: new→archive)
       │               │              edge           │
       │               │                             │
       │               │           4. re-embed       │──► Ollama (new content)
       │               │                             │
       │               │           5. updateChunk    │──► KuzuDB
       │               │              version++      │    (delete+recreate if
       │               │              preserve conf  │     embedding changed)
       │               │              preserve lifecycle
       │               │                             │
       │               │           6. relinkChunk    │──► KuzuDB
       │               │              delete auto    │    (auto edges only,
       │               │              re-run linking │     manual preserved)
       │               │                             │
       │               │◄───────────────────────────│
       │  { id,        │                             │
       │    version,   │                             │
       │    superseded}│                             │
       │◄──────────────┤                             │
       ▼               ▼                             ▼
```

---

### knowledge_validate

Confirm or refute a knowledge chunk, driving the lifecycle state machine.
Confirmation boosts confidence with diminishing returns and increments
validation count. Refutation reduces confidence with amplifying impact.
Auto-promotes hypothesis to validated when 3+ confirmations reach >= 0.85
confidence. Refutes chunks when confidence drops below 0.2. Revives refuted
chunks back to hypothesis on confirmation if confidence recovers to >= 0.2.

```
 ┌──────────┐    ┌───────────┐    ┌──────────────────────────────────────────┐
 │  Claude   │    │ client.ts │    │  daemon.ts → handleValidate()            │
 └─────┬────┘    └─────┬─────┘    └──────────────────┬───────────────────────┘
       │               │                             │
       │  knowledge_   │                             │
       │  validate()   │  POST /rpc                  │
       ├──────────────►├────────────────────────────►│
       │               │                             │
       │               │           1. getChunk(id)   │──► KuzuDB
       │               │                             │
       │               │           2. compute new    │
       │               │              confidence     │
       │               │                             │
       │               │           ┌── confirm ──────┤
       │               │           │  conf += boost  │
       │               │           │  × decay_factor │
       │               │           │  val_count++    │
       │               │           │                 │
       │               │           │  if hypothesis  │
       │               │           │  + val≥3        │
       │               │           │  + conf≥0.85:   │
       │               │           │  → validated    │
       │               │           │  (auto-promote) │
       │               │           │                 │
       │               │           │  if refuted     │
       │               │           │  + conf≥0.2:    │
       │               │           │  → hypothesis   │
       │               │           │  (revive)       │
       │               │           ├── refute ───────┤
       │               │           │  conf -= penalty│
       │               │           │  × amplify      │
       │               │           │  ref_count++    │
       │               │           │                 │
       │               │           │  if conf<0.2:   │
       │               │           │  → refuted      │
       │               │           └─────────────────┤
       │               │                             │
       │               │           3. updateChunk    │──► KuzuDB
       │               │              confidence     │
       │               │              counts         │
       │               │              lifecycle      │
       │               │              last_validated  │
       │               │                             │
       │               │◄───────────────────────────│
       │  { id, action,│                             │
       │    confidence, │                             │
       │    lifecycle,  │                             │
       │    auto_prom } │                             │
       │◄──────────────┤                             │
       ▼               ▼                             ▼
```

---

### knowledge_promote

Graduate a knowledge chunk to a higher lifecycle status. Runs guard checks
(rejects refuted, low-confidence, or already-canonical chunks), then advances
the lifecycle: hypothesis → validated → promoted → canonical (canonical
requires confidence >= 0.9). Can optionally change category and importance.
Per the golden evidence policy, Claude should verify all 4 evidence sources
(docs, code, tests, task tracking) before calling this tool.

```
 ┌──────────┐    ┌───────────┐    ┌──────────────────────────────────────────┐
 │  Claude   │    │ client.ts │    │  daemon.ts → handlePromote()             │
 └─────┬────┘    └─────┬─────┘    └──────────────────┬───────────────────────┘
       │               │                             │
       │  knowledge_   │                             │
       │  promote()    │  POST /rpc                  │
       ├──────────────►├────────────────────────────►│
       │               │                             │
       │               │           1. getChunk(id)   │──► KuzuDB
       │               │                             │
       │               │           2. guard checks   │
       │               │              conf < 0.2?    │──► Error: refuted
       │               │              conf < 0.5?    │──► Error: low confidence
       │               │              canonical?     │──► Error: already canonical
       │               │                             │
       │               │           3. compute next   │
       │               │              lifecycle      │
       │               │                             │
       │               │           hypothesis        │
       │               │             → validated     │
       │               │           validated         │
       │               │             → promoted      │
       │               │           active            │
       │               │             → promoted      │
       │               │           promoted          │
       │               │             + conf≥0.9      │
       │               │             → canonical     │
       │               │           promoted          │
       │               │             + conf<0.9      │
       │               │             → Error         │
       │               │                             │
       │               │           4. updateChunk    │──► KuzuDB
       │               │              lifecycle      │
       │               │              category?      │
       │               │              importance?    │
       │               │                             │
       │               │◄───────────────────────────│
       │  { id,        │                             │
       │    prev/new   │                             │
       │    lifecycle,  │                             │
       │    confidence }│                             │
       │◄──────────────┤                             │
       ▼               ▼                             ▼
```

---

### knowledge_link

Create a manual directed edge between two chunks using one of 15 relation types
(e.g., `depends_on`, `contradicts`, `requires`). Auto-linking only creates
`RELATES_TO` edges — this tool lets Claude express specific semantic
relationships. Validates both chunks exist before creating the edge.

```
 ┌──────────┐    ┌───────────┐    ┌──────────────────────────────────────────┐
 │  Claude   │    │ client.ts │    │  daemon.ts → handleLink()                │
 └─────┬────┘    └─────┬─────┘    └──────────────────┬───────────────────────┘
       │               │                             │
       │  knowledge_   │                             │
       │  link()       │  POST /rpc                  │
       ├──────────────►├────────────────────────────►│
       │               │                             │
       │               │           1. validate       │
       │               │              relation type  │──► RELATION_TABLE_MAP
       │               │              (15 types)     │    (types.ts)
       │               │                             │
       │               │           2. verify source  │──► KuzuDB
       │               │              chunk exists   │    getChunk(source_id)
       │               │                             │
       │               │           3. verify target  │──► KuzuDB
       │               │              chunk exists   │    getChunk(target_id)
       │               │                             │
       │               │           4. createRelation │──► KuzuDB
       │               │              source→target  │    directed edge
       │               │              with relation  │
       │               │                             │
       │               │◄───────────────────────────│
       │  { created,   │                             │
       │    source_id,  │                             │
       │    target_id,  │                             │
       │    relation }  │                             │
       │◄──────────────┤                             │
       ▼               ▼                             ▼
```

---

### knowledge_delete

Permanently remove a chunk and every edge touching it using KuzuDB's
`DETACH DELETE`. Irreversible — use when knowledge is obsolete or wrong
beyond what refutation can express. Consider `knowledge_validate` with
`refute` first if the knowledge might be partially salvageable.

```
 ┌──────────┐    ┌───────────┐    ┌──────────────────────────────────────────┐
 │  Claude   │    │ client.ts │    │  daemon.ts → handleDelete()              │
 └─────┬────┘    └─────┬─────┘    └──────────────────┬───────────────────────┘
       │               │                             │
       │  knowledge_   │                             │
       │  delete()     │  POST /rpc                  │
       ├──────────────►├────────────────────────────►│
       │               │                             │
       │               │           1. verify chunk   │──► KuzuDB
       │               │              exists         │    getChunk(id)
       │               │                             │
       │               │           2. DETACH DELETE  │──► KuzuDB
       │               │              removes node   │    node + ALL edges
       │               │              + all edges    │    (in + out)
       │               │              (irreversible) │
       │               │                             │
       │               │◄───────────────────────────│
       │  { deleted,   │                             │
       │    id }       │                             │
       │◄──────────────┤                             │
       ▼               ▼                             ▼
```

