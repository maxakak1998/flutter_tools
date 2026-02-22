# Layer 1: MCP Server

**Entry point**: `src/cli.ts` → `src/index.ts`

The CLI (`cli.ts`) handles arg parsing, config resolution, and command dispatch. The `serve` command calls `main(config)` from `index.ts`.

---

## Transport

Uses `StdioServerTransport` from `@modelcontextprotocol/sdk`. Communication happens over stdin/stdout using the JSON-RPC protocol.

**Critical constraint**: `console.log` is forbidden. Any stdout output corrupts the JSON-RPC stream. All logging uses `console.error` via the `log()` wrapper from `types.ts`.

---

## Tool Registration

Each tool is registered with `server.tool(name, description, zodSchema, handler)`:

```typescript
server.tool(
  'knowledge_query',                    // tool name
  'Search knowledge base...',            // description
  { query: z.string(), filters: ... },   // zod schema for validation
  async ({ query, filters }) => { ... }  // handler
);
```

The MCP SDK validates input against the zod schema before calling the handler. Zod schemas use config values for limits (e.g., `z.string().max(limits.maxContentLength)`).

---

## CLI Commands

| Command | Action |
|---------|--------|
| `serve` (default) | Load config → start MCP server |
| `setup` | Create `knowledge.json` + write MCP config to `~/.claude/settings.json` |
| `doctor` | Check Node version, Ollama, model, DB path, dashboard port |

---

## Startup Lifecycle

```
1. CLI parses args and resolves config:
   knowledge.json → env vars → CLI flags (highest priority)
2. main(config) called with resolved KnowledgeConfig
3. Instantiate: KuzuStorage(db.path), Embedder(ollama.url, ollama.model, cache.embeddingCacheSize),
   Retriever(storage, embedder, search.defaultLimit), Linker(storage, embedder, search.similarityThreshold, search.autoLinkTopK)
4. Create McpServer instance
5. Register all 8 tools (with config-driven zod limits)
6. Health check Ollama (GET /api/tags, verify configured model)
   └─ If fails: log warning, continue (embedding will fail until Ollama ready)
7. Initialize storage (create dirs, load vector extension, create schema/indices)
   └─ If fails: log error, process.exit(1)
8. Start dashboard HTTP server (if dashboard.enabled)
9. Connect StdioServerTransport
10. Register SIGINT/SIGTERM handlers
```

---

## Graceful Shutdown

On `SIGINT` or `SIGTERM`:
1. Close KuzuStorage (connection + database)
2. Close MCP server
3. `process.exit(0)`

---

## Error Handling

### Error Wrapping

Every tool handler wraps its logic in try-catch:

```typescript
try {
  const result = await handler(...);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
} catch (e) {
  return {
    content: [{ type: 'text', text: `Error: ${e.message}` }],
    isError: true,
  };
}
```

This ensures tool errors are returned as error responses rather than crashing the server.

### Startup Health Check

```
Ollama check:
├─ GET /api/tags → not responding? → log warning, continue
├─ Response OK but no bge-m3? → log "run ollama pull bge-m3", continue
└─ bge-m3 found? → log "health check passed"

Storage init:
├─ mkdirSync parent directory
├─ new Database(path) + init()
├─ new Connection(db) + init()
├─ INSTALL/LOAD vector extension
├─ Create schema (idempotent)
├─ Create indices (idempotent)
└─ Any failure? → log error, process.exit(1)
```

### Error Patterns

- Every tool handler: try-catch → `{ isError: true, text: "Error: ..." }`
- Fatal startup errors: `process.exit(1)`
- Unhandled promise: `runServe().catch()` in `cli.ts` → log + `process.exit(1)`
