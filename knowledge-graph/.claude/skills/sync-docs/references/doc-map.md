# Documentation Map

## Table of Contents

1. [Files and Their Scope](#files-and-their-scope)
2. [Change-to-File Matrix](#change-to-file-matrix)
3. [Per-File Consistency Checks](#per-file-consistency-checks)

---

## Files and Their Scope

| File | Scope | Canonical For |
|------|-------|---------------|
| `CLAUDE.md` | Everything (summary level) | Quick reference, Key Files table, System Constraints table, Component Overview, CLI tables, architecture summary |
| `docs/architecture.md` | 4-layer overview, data flows, config, limitations | Layer diagram, layer relationships, config tables, known limitations |
| `docs/mcp-server.md` | Layer 1: CLI, transport, startup, shutdown | Entry point path, startup lifecycle, CLI commands table |
| `docs/tool-handlers.md` | Layer 2: Each tool handler's flow | Handler parameters, internal flows, result types |
| `docs/engine.md` | Layer 3: Embedder, Retriever, Linker | Search pipeline steps, scoring weights, auto-link thresholds |
| `docs/storage.md` | Layer 4: KuzuDB schema, CRUD, vector index | Table schemas, relation tables, column types, type aliases |
| `docs/tools.md` | MCP tool reference (user-facing) | Tool count, parameter tables, return types, usage examples |
| `docs/metadata.md` | Metadata schema reference | Field constraints, zod validation rules, normalization behavior |
| `docs/claude-interaction.md` | ASCII diagrams of all flows | Architecture diagrams, project discovery, daemon lifecycle, store/query flows |

---

## Change-to-File Matrix

Use this matrix to determine which doc files need updating after a code change.

| Code Change | CLAUDE.md | claude-interaction.md | architecture.md | mcp-server.md | tool-handlers.md | engine.md | storage.md | tools.md | metadata.md |
|---|---|---|---|---|---|---|---|---|---|
| File added/deleted in `src/` | Key Files, Component Overview | - | Layer diagram (if Layer 1) | Entry point (if CLI/transport) | - | - | - | - | - |
| Tool added/removed/renamed | Tools table, Constraints | Tool call lifecycle | - | Tool registration | Add/remove handler section | - | - | Tool table + param section | Field constraints (if schema changed) |
| Tool parameter changed | Constraints (if limit) | - | - | Zod schema | Handler params | - | - | Param table | Field constraints |
| Config default changed | Config table, Constraints | - | Config section | - | - | Constructor values (if engine) | - | - | - |
| CLI command added/removed | CLI Commands table | - | - | CLI Commands table | - | - | - | - | - |
| CLI flag added/removed | CLI Options table | - | - | CLI Flags table | - | - | - | - | - |
| Search pipeline changed | Constraints | Query flow diagram | - | - | - | Pipeline steps, weights | - | - | - |
| Scoring weights changed | Constraints | Score merge diagram | - | - | - | Weight table | - | - | - |
| Auto-link threshold changed | Constraints | - | - | - | - | Linker section | - | - | - |
| Schema column added/removed | Constraints, Key Files | - | - | - | - | - | Table schema | - | Field constraints |
| Relation type added/removed | Constraints | - | - | - | Handler (if link tool) | - | Relation tables | Param enum | - |
| Architecture changed (mode/flow) | Architecture section, Component Overview | All diagrams | Layer diagram | Entry point, startup | - | - | - | - | - |
| Daemon behavior changed | - | Daemon lifecycle, shutdown | - | - | - | - | - | - | - |
| Project discovery changed | Project System section | Project discovery diagram | - | - | - | - | - | - | - |
| Category/importance enum changed | - | - | - | - | - | - | Type aliases | Param enums | Enum values |
| Dedup threshold changed | Constraints | Store flow diagram | - | - | Store handler | - | Semantic dedup section | Store behavior | Dedup section |
| Lifecycle/confidence changed | Lifecycle section, Constraints | Lifecycle diagram | - | - | Validate/promote handlers | - | Learning columns | Validate/promote tools | - |
| Validation policy changed | Validation Policy section | Evidence diagrams, lifecycle diagram | - | - | Validate/promote handlers | - | - | Validate/promote golden evidence notes | - |
| Promotion evidence requirements changed | Validation Policy section | Golden evidence check diagram | - | - | Promote handler | - | - | Promote golden evidence section | - |

---

## Per-File Consistency Checks

### CLAUDE.md

| Section | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| CLI Commands table | Every command has a handler in `cli.ts` | `cli.ts` switch statement |
| CLI Options table | Every flag is parsed in `parseArgs()` | `cli.ts` parseArgs function |
| Operating Mode | Matches `cli.ts` serve logic | `cli.ts` runServe function |
| Component Overview | Lists all primary `src/*.ts` modules | `src/` directory listing |
| Key Files table | Every primary `.ts` file in `src/` appears; no deleted files remain | `src/` directory listing |
| System Constraints table | Every value matches code; source file exists | Grep each constant in source |
| Config tables | Default values match `config.ts` DEFAULT_CONFIG | `config.ts` |
| Tools table | Count and names match registered tools | `daemon.ts` tool registrations |
| Project System | `discoverProject()` behavior described accurately | `project.ts` |

### docs/claude-interaction.md

| Diagram | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| High-Level Architecture | Mode detection matches `cli.ts` serve | `cli.ts` runServe |
| Project Discovery | Walk/check logic matches `discoverProject()` | `project.ts` |
| Project Mode | Client-daemon-DB flow matches actual | `client.ts`, `daemon.ts` |
| Tool Call Lifecycle | Layer traversal matches actual call path | `daemon.ts` → `tools/*.ts` → `engine/` → `storage/` |
| Store Flow | Steps match `handleStore()` | `tools/store.ts` |
| Query Flow | Steps match `retriever.search()` | `engine/retriever.ts` |
| Daemon Lifecycle | Steps match `ensureDaemon()` | `daemon-manager.ts` |
| Shutdown Behavior | Signal handling matches `client.ts` | `client.ts` |

### docs/architecture.md

| Section | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| 4-Layer diagram | Layer names and file references correct | `src/` structure |
| Layer Relationships | Dependency direction accurate | Import statements |
| Data Flows | Store/Query/Evolve flows match handlers | `tools/*.ts` |
| Config tables | Values match `config.ts` | `config.ts` |
| Known Limitations | Still accurate, resolved ones marked | Codebase |

### docs/tools.md

| Section | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| Overview table | Tool count matches registered tools | `daemon.ts` |
| Each tool section | Parameters match zod schema | `daemon.ts` tool registration |
| Each tool section | Return type matches handler | `tools/*.ts` return values |
| Each tool section | Behavior description matches implementation | `tools/*.ts` |

### docs/tool-handlers.md

| Section | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| Each handler | File path and line count roughly accurate | `src/tools/*.ts` |
| Each handler | Parameters match function signature | `tools/*.ts` function params |
| Each handler | Flow steps match implementation | `tools/*.ts` |
| Result types | Match TypeScript interfaces | `types.ts` |

### docs/engine.md

| Section | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| Embedder | Constructor params match config injection | `engine/embedder.ts` |
| Retriever | Pipeline steps match implementation | `engine/retriever.ts` |
| Retriever | Scoring weights match constants | `engine/retriever.ts` |
| Linker | Thresholds match config values | `engine/linker.ts`, `config.ts` |
| Keyword scoring | Algorithm matches `computeKeywordScore()` | `engine/retriever.ts` |

### docs/storage.md

| Section | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| Chunk table | Columns match CREATE TABLE | `storage/kuzu.ts` |
| Relation tables | Match RELATION_TABLE_MAP | `types.ts` |
| Type aliases | Enum values match TypeScript types | `types.ts` |

### docs/metadata.md

| Section | What to Verify | Source of Truth |
|---------|---------------|-----------------|
| Field constraints | Match zod schemas | `daemon.ts` (or tool registration file) |
| Enum values | Match zod enum definitions | `daemon.ts`, `types.ts` |
| Validation rules | Match actual behavior | `tools/store.ts`, zod schemas |
| Normalization | Match store handler logic | `tools/store.ts` |
