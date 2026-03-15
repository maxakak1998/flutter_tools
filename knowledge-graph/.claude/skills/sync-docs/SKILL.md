---
name: sync-docs
description: Audit and fix consistency between code, CLAUDE.md, and docs/ after any code change. Use after modifying source files in the knowledge-graph project — adding/deleting files, changing tool parameters, updating config defaults, modifying architecture, changing CLI commands, or altering schemas. Triggers on keywords like "sync docs", "update docs", "docs consistency", or after completing a code change that may have left documentation stale.
---

# Sync Docs

Audit CLAUDE.md and docs/ against the codebase. The code is always the source of truth — update docs to match code, never the reverse.

## Workflow

### 1. Identify what changed

Determine which code files were modified. Use `git diff` or review the recent work.

### 2. Look up affected docs

Read [references/doc-map.md](references/doc-map.md) — the **Change-to-File Matrix** maps each code change type to the doc files that need updating.

Example: deleting a source file affects CLAUDE.md (Key Files, Component Overview) and possibly docs/architecture.md and docs/mcp-server.md.

### 3. Run per-file checks

For each affected doc file, use the **Per-File Consistency Checks** section in [references/doc-map.md](references/doc-map.md). It lists exactly what to verify and where the source of truth lives.

### 4. Fix drift

Apply precise edits — don't rewrite entire sections for a one-word fix.

### 5. Verify build

Run `npm run build` to confirm no TypeScript errors were introduced.

## Quick Reference: Common Changes

| You did this | Update these |
|---|---|
| Added/deleted a `src/*.ts` file | CLAUDE.md Key Files + Component Overview |
| Changed a config default | CLAUDE.md Config + Constraints tables, `docs/architecture.md` Config section |
| Added/removed a tool | CLAUDE.md Tools table + Constraints, `docs/tools.md`, `docs/tool-handlers.md` |
| Changed search scoring | CLAUDE.md Constraints, `docs/engine.md`, `docs/claude-interaction.md` Query flow |
| Changed CLI command/flag | CLAUDE.md CLI tables, `docs/mcp-server.md` CLI section, `cli.ts` help text |
| Changed architecture flow | CLAUDE.md Architecture section, `docs/claude-interaction.md` diagrams, `docs/architecture.md` |
| Changed schema/relations | CLAUDE.md Constraints, `docs/storage.md`, `docs/metadata.md` |

## Checklist

Copy into commit message or PR after completing sync:

```
Docs sync:
[ ] Key Files table matches src/ files
[ ] System Constraints values match code
[ ] Component Overview matches src/ modules
[ ] Architecture diagrams match code flow
[ ] Tool docs match registered tools (count, params, returns)
[ ] Config defaults match config.ts
[ ] Schema docs match kuzu.ts + types.ts
[ ] Metadata docs match zod schemas
[ ] CLI docs match cli.ts
```
