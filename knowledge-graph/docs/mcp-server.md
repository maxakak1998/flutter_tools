# Layer 1: MCP Server

**Entry point**: `src/cli.ts` → `src/daemon-manager.ts` → `src/daemon.ts` + `src/client.ts`

The system uses a daemon+client architecture. The CLI (`cli.ts`) handles arg parsing, config resolution, and command dispatch. The `serve` command discovers the project, ensures a daemon is running via `daemon-manager.ts`, and starts the MCP client proxy (`client.ts`) that forwards tool calls to the daemon over HTTP.

---

## Transport

The client (`client.ts`) uses `StdioServerTransport` from `@modelcontextprotocol/sdk`. Communication with Claude Code happens over stdin/stdout using the JSON-RPC protocol. The client forwards all tool calls to the daemon via HTTP `POST /rpc`.

**Critical constraint**: `console.log` is forbidden. Any stdout output corrupts the JSON-RPC stream. All logging uses `console.error` via the `log()` wrapper from `types.ts`.

---

## Tool Registration

Tools are registered in `client.ts` using a `proxyTool()` helper that wraps each tool as an HTTP proxy to the daemon:

```typescript
function proxyTool(name, description, schema, methodName) {
  server.tool(name, description, schema, async (params) => {
    try {
      const result = await rpcCall(daemonUrl, methodName, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  });
}
```

Zod schemas in `client.ts` validate input before forwarding. The daemon dispatches to the actual handler via `dispatchRpc()` in `daemon.ts`.

---

## CLI Commands

| Command | Action |
|---------|--------|
| `serve` | Discover project → ensure daemon → start MCP client proxy |
| `stop` | Stop the running daemon for the current project |
| `init [--force]` | Initialize `.knowledge-graph/` in current directory |
| `serve-standalone` | Start daemon + dashboard without MCP (standalone browsing mode) |
| `setup` | Write default config + print MCP registration instructions |
| `doctor` | Check Node version, Ollama, model, DB path, daemon, port |
| `reset-db` | Delete the database (all chunks, edges, embeddings) |
| `uninstall [--keep-data]` | Remove installed files, config, and MCP registration |

Note: Running `knowledge-graph` with no command prints help text.

### CLI Options

| Option | Description |
|--------|-------------|
| `--db-path <path>` | Override database path |
| `--ollama-url <url>` | Ollama API endpoint |
| `--ollama-model <name>` | Embedding model name |
| `--force, -f` | Force init even if parent has `.knowledge-graph/` |
| `--keep-data` | Keep database on uninstall |
| `-h, --help` | Print help text |
| `-v, --version` | Print version |

### Environment Variables

| Variable | Maps To | Purpose |
|----------|---------|---------|
| `KNOWLEDGE_DB_PATH` | `db.path` | Database directory path |
| `OLLAMA_URL` | `ollama.url` | Ollama API endpoint |
| `OLLAMA_MODEL` | `ollama.model` | Embedding model name |

Priority: CLI flags > env vars > `knowledge.json` > hard defaults.

---

## Startup Lifecycle

### Client startup (`serve` command)

```
1. CLI parses args and resolves config:
   CLI flags → env vars → knowledge.json → hard defaults (highest priority first)
2. discoverProject(cwd) → find .knowledge-graph/config.json
   └─ If not found: log error, exit with "run kg init first"
3. ensureDaemon(project, config):
   ├─ Check daemon.port file → health check existing daemon (verifies `status === 'ok'` AND `project_id` matches current project)
   ├─ Check daemon.pid file → detect zombie processes
   └─ If no valid daemon → fork() new daemon, poll for daemon.port file (15s timeout)
4. clientMain(daemonUrl, projectId):
   ├─ POST /rpc/connect to register with daemon
   ├─ Create McpServer instance
   ├─ Register all 8 tools via proxyTool() (with Zod schemas)
   ├─ Connect StdioServerTransport
   └─ Register SIGINT/SIGTERM handlers
```

### Daemon startup (spawned by `daemon-manager.ts`)

```
1. Parse 3 required env vars: KG_DAEMON_CONFIG (JSON config), KG_PROJECT_DIR (.knowledge-graph/ path), KG_PROJECT_ID (project identifier). Also reads KG_IDLE_TIMEOUT_MS (default 300000) and KG_PORT_RANGE_START (default 0).
2. createCore(config):
   ├─ Instantiate: KuzuStorage, Embedder, Retriever, Linker, EventBus
   ├─ Health check Ollama (GET /api/tags, verify configured model)
   │   └─ If fails: log warning, continue (embedding will fail until Ollama ready)
   └─ Initialize storage (create dirs, load vector extension, create schema/indices)
       └─ If fails: log error, process.exit(1)
3. Create DashboardServer (hosts API routes + SSE)
4. Register dashboard triggers for query, store, evolve, validate, promote
5. Create HTTP server on 127.0.0.1 (port 0 = OS auto-assign, or set `daemon.port_range_start` in `.knowledge-graph/config.json`)
   Endpoints: POST /rpc (tool dispatch), POST /rpc/connect, POST /rpc/disconnect, POST /rpc/shutdown, GET /health (returns { status, project_id, clients, uptime_ms }), all other routes → dashboard
6. Write daemon.port and daemon.pid files
7. Start idle timer (auto-shutdown after configurable timeout, default 300s)
```

---

## Graceful Shutdown

### Client shutdown

- **SIGINT** (Ctrl+C): User explicitly wants to stop everything
  1. Send `POST /rpc/shutdown` to kill the daemon
  2. Close MCP server
  3. `process.exit(0)`

- **SIGTERM** (Claude Code exiting): Preserve daemon for other sessions
  1. Send `POST /rpc/disconnect` to decrement client count
  2. Close MCP server
  3. `process.exit(0)`

### Daemon shutdown

Triggered by `/rpc/shutdown`, SIGTERM, SIGINT, or idle timeout:

1. Close DashboardServer (stop SSE connections)
2. Close KuzuStorage (connection + database)
3. Close HTTP server
4. Remove `daemon.port` and `daemon.pid` files
5. `process.exit(0)`

### Idle auto-shutdown

The daemon starts an idle timer immediately on startup (before any client connects). On `/rpc/connect`, the timer is reset (cleared). On `/rpc/disconnect`, if no clients remain (`clientCount <= 0`), the timer restarts. If no client connects or reconnects before the timer expires (default 300s, configurable via `daemon.idle_timeout_ms` in `.knowledge-graph/config.json`), the daemon shuts itself down.

---

## Error Handling

### Two-Layer Error Wrapping

Errors are caught at two levels:

**Layer 1 — Client proxy** (`client.ts`):
```typescript
// proxyTool wraps each forwarded call
try {
  const result = await rpcCall(daemonUrl, methodName, params);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
} catch (e) {
  return {
    content: [{ type: 'text', text: `Error: ${e.message}` }],
    isError: true,
  };
}
```

**Layer 2 — Daemon RPC dispatch** (`daemon.ts`):
```typescript
// dispatchRpc catches handler errors and returns JSON-RPC error responses
try {
  const result = await dispatchRpc(rpcReq.method, rpcReq.params);
  sendJson(res, formatResult(rpcReq.id, result));
} catch (e) {
  sendJson(res, formatError(rpcReq.id, -32603, e.message));
}
```

This ensures tool errors are returned as error responses rather than crashing either process.

### Startup Health Check

```
Ollama check (in createCore):
├─ GET /api/tags → not responding? → log warning, continue
├─ Response OK but no bge-m3? → log "run ollama pull bge-m3", continue
└─ bge-m3 found? → log "health check passed"

Storage init (in createCore):
├─ mkdirSync parent directory
├─ new Database(path) + init()
├─ new Connection(db) + init()
├─ INSTALL/LOAD vector extension
├─ Create schema (idempotent)
├─ Create indices (idempotent)
└─ Any failure? → log error, process.exit(1)
```

### Error Patterns

- Client proxy errors: `{ isError: true, text: "Error: ..." }` (MCP error response)
- Daemon RPC errors: JSON-RPC error format `{ error: { code: -32603, message: "..." } }`
- Fatal startup errors: `process.exit(1)`
- Daemon spawn timeout: throws `Error("Daemon startup timed out after 15s")`
