# MCP Tool Reference

8 tools exposed to Claude via JSON-RPC over stdio.

---

## Overview

| # | Tool | Purpose | When to use |
|---|------|---------|-------------|
| 1 | `knowledge_store` | Store one chunk | Single piece of knowledge with metadata |
| 2 | `knowledge_query` | Search | Find relevant knowledge by natural language |
| 3 | `knowledge_list` | Browse | See what's stored, filter by domain/category/lifecycle/confidence |
| 4 | `knowledge_link` | Link chunks | Create manual relationship between two chunks |
| 5 | `knowledge_evolve` | Update chunk | New content, re-embed, version bump, re-link |
| 6 | `knowledge_delete` | Delete chunk | Remove chunk and all its relationships |
| 7 | `knowledge_validate` | Confirm/refute | Drive lifecycle via evidence-backed validation |
| 8 | `knowledge_promote` | Graduate chunk | Promote lifecycle status (requires golden evidence) |

---

## 1. knowledge_store

Store a single knowledge chunk. Embeds content, creates graph node, auto-links to similar chunks, checks for duplicates.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | Knowledge text (max 5000 chars) |
| `metadata.summary` | string | yes | 1-sentence description (max 200 chars) |
| `metadata.keywords` | string[] | yes | 1-15 key terms (each 2+ chars) |
| `metadata.domain` | string | yes | Topic area, free-form (max 50 chars, e.g. `"dependency-injection"`) |
| `metadata.category` | enum | yes | `fact` `rule` `insight` `question` `workflow` |
| `metadata.importance` | enum | yes | `critical` `high` `medium` `low` |
| `metadata.entities` | string[] | no | Named things (class names, tools), each 2+ chars |
| `metadata.suggested_relations` | object[] | no | `{ concept, relation }` — hints for auto-linking |
| `metadata.tags` | string[] | no | Free-form tags |
| `metadata.source` | string | no | Origin file path or identifier |
| `metadata.layer` | string | no | Auto-inferred from category if omitted |

**Returns**: `{ id, auto_links[], warnings[], duplicate_of?, similarity?, existing_content?, existing_summary?, action_hint?, related_knowledge? }`

**Behavior**:
- Semantic dedup: near-identical content (>= dedup threshold, default 0.88) returns existing chunk ID with `duplicate_of` and `action_hint` suggesting `knowledge_evolve`
- Embeds via Ollama (1 API call)
- Auto-links to similar chunks above similarity threshold (default 0.82)
- Proactive surfacing: searches top 5 candidates (hardcoded) and returns validated/canonical/promoted chunks with similarity 0.60 to < dedup threshold (default 0.88) as `related_knowledge`
- Learning defaults: `insight`/`question` start at lifecycle `hypothesis` with confidence 0.3; others start at `active` with confidence 0.5

---

## 2. knowledge_query

Search the knowledge base using hybrid retrieval: vector similarity + keyword matching + graph traversal + confidence boost.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Natural language search query |
| `filters.domain` | string | no | Filter by domain |
| `filters.category` | enum | no | `fact` `rule` `insight` `question` `workflow` |
| `filters.importance` | enum | no | `critical` `high` `medium` `low` |
| `filters.tags` | string[] | no | Filter by tags |
| `filters.layer` | string | no | Filter by layer |
| `filters.min_confidence` | number | no | Min effective confidence (0.0-1.0, applies temporal decay) |
| `filters.lifecycle` | enum | no | `hypothesis` `validated` `promoted` `canonical` `refuted` `active` |
| `filters.since` | string | no | ISO timestamp — only chunks updated after this date |

**Returns**: `{ chunks: QueryChunk[], total }`

Each `QueryChunk` contains:
- `id` — chunk identifier
- `content` — full knowledge text
- `metadata` — includes all `ChunkMetadata` fields (summary, keywords, domain, category, importance, entities, tags, source, layer) plus: `version`, `created_at`, `updated_at`, `confidence` (raw stored value — no temporal decay applied), `lifecycle`, `validation_count`, `access_count`
- `score` — relevance score (0-1)

Note: `knowledge_query` returns raw `confidence`. For effective confidence with temporal decay, use `knowledge_list` which returns both `confidence` and `effective_confidence`.

**Behavior**:
- Embeds query, runs vector search (50 candidates), keyword boost, graph expansion (depth 1 from top 3), score merge, confidence boost
- Excludes `lifecycle=refuted` by default (unless explicitly filtered)
- Falls back to keyword-only search if Ollama is unavailable
- Increments `access_count` for all returned chunks

---

## 3. knowledge_list

Browse stored chunks with optional filters. Returns summary view with effective confidence.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `filters.domain` | string | no | Filter by domain |
| `filters.category` | enum | no | `fact` `rule` `insight` `question` `workflow` |
| `filters.importance` | enum | no | `critical` `high` `medium` `low` |
| `filters.tags` | string[] | no | Filter by tags |
| `filters.source` | string | no | Filter by source |
| `filters.layer` | string | no | Filter by layer |
| `filters.min_confidence` | number | no | Min effective confidence (0.0-1.0) |
| `filters.lifecycle` | enum | no | `hypothesis` `validated` `promoted` `canonical` `refuted` `active` |
| `filters.since` | string | no | ISO timestamp — only chunks updated after this date |
| `limit` | number | no | Max results (default 50) |

**Returns**: `{ chunks[], total }`

Each chunk summary: `id`, `summary`, `domain`, `category`, `importance`, `layer`, `source`, `version`, `updated_at`, `tags`, `confidence`, `effective_confidence`, `lifecycle`, `validation_count`, `access_count`, `last_validated_at`.

Note: Unlike `knowledge_query`, `knowledge_list` does NOT filter out `lifecycle=refuted` chunks by default. Refuted chunks are included unless explicitly filtered out with `filters.lifecycle`.

---

## 4. knowledge_link

Create a manual relationship between two knowledge chunks.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `source_id` | string | yes | Source chunk ID |
| `target_id` | string | yes | Target chunk ID |
| `relation` | enum | yes | `relates_to` `depends_on` `contradicts` `supersedes` `triggers` `requires` `produces` `is_part_of` `constrains` `precedes` `is_true` `is_false` `transitions_to` `mutates` `governed_by` |

**Returns**: `{ created, source_id, target_id, relation }`

**Behavior**:
- Validates both chunks exist
- Creates a directed edge in the graph

---

## 5. knowledge_evolve

Update an existing chunk with new content. Re-embeds, bumps version, re-links. Preserves confidence and lifecycle.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Chunk ID to evolve |
| `new_content` | string | yes | Updated content (max 5000 chars) |
| `new_metadata` | object | no | Partial metadata: `summary`, `keywords`, `domain`, `category`, `importance`, `layer`, `entities`, `suggested_relations`, `tags`. Note: `source` is NOT available. |
| `reason` | string | yes | Why this chunk is being updated |

**Returns**: `{ id, version, reason, superseded_id, note }`

**Behavior**:
- Archives old version as a separate chunk (importance forced to `low`, tagged `archived`)
- Creates `SUPERSEDES` edge from current to archive
- Re-embeds new content
- Version bumps (`v1` -> `v2` -> ...)
- Deletes auto-created links, preserves manual links, re-runs auto-linking
- Preserves confidence, validation_count, lifecycle, and other learning fields
- Always returns `note` suggesting re-validation (unconditional)

---

## 6. knowledge_delete

Delete a chunk and all its relationships.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Chunk ID to delete |

**Returns**: `{ deleted, id }`

**Behavior**:
- Uses `DETACH DELETE` — removes the node and every edge touching it
- Irreversible

---

## 7. knowledge_validate

Confirm or refute a knowledge chunk. Drives the lifecycle state machine.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Chunk ID to validate |
| `action` | enum | yes | `confirm` or `refute` |
| `evidence` | string | no | Citation or proof (strongly recommended — see golden evidence) |
| `context` | string | no | Additional context for the validation |

**Returns**: `{ id, action, confidence, validation_count, refutation_count, lifecycle, auto_promoted, promotion_details? }`

Note: The `action` field in the response returns the past tense form: `'confirmed'` or `'refuted'` (not the input values `'confirm'`/`'refute'`).

**Behavior**:
- **Confirm**: boosts confidence (diminishing returns), increments `validation_count`
- **Refute**: reduces confidence (amplifying impact), increments `refutation_count`
- Auto-promotes `hypothesis` → `validated` when `validation_count >= 3` AND `confidence >= 0.85`
- Auto-sets `lifecycle=refuted` when `confidence < 0.2`
- Revives `refuted` → `hypothesis` when confirmed and `confidence >= 0.2`

**Golden evidence guidance**: Always include `evidence` citing the specific source. Golden sources (docs, code, tests, task tracking) count toward promotion readiness. Weak sources (user prompt, LLM inference) adjust confidence but cannot satisfy golden evidence requirements. See CLAUDE.md Validation Policy.

---

## 8. knowledge_promote

Promote a knowledge chunk to a higher lifecycle status. Requires all 4 golden evidence sources verified.

**Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Chunk ID to promote |
| `reason` | string | yes | Why this chunk is being promoted (use golden evidence format) |
| `new_category` | enum | no | Optionally change category: `fact` `rule` `insight` `question` `workflow` |
| `new_importance` | enum | no | Optionally change importance: `critical` `high` `medium` `low` |

**Returns**: `{ id, previous_category, new_category, previous_lifecycle, new_lifecycle, confidence, reason }`

**Lifecycle transitions**: hypothesis → validated → promoted → canonical (requires conf >= 0.9). Also supports `active` → `promoted` directly.

**Guards**:
- Cannot promote refuted chunks (confidence < 0.2)
- Cannot promote low-confidence chunks (confidence < 0.5)
- Cannot promote already-canonical chunks

**Golden evidence requirement**: Before calling, verify ALL 4 golden evidence sources:
1. Documentation — `docs/` or `CLAUDE.md` confirms the knowledge
2. Code — `src/` or `lib/` proves it
3. Tests — `test/` or `scripts/` verifies it
4. Task tracking — Jira/beads issue tracks it

Use reason format: `Golden Evidence: [docs:path] [code:path:line] [tests:path] [task:issue-id]`

If any source is missing, ask the user to create it before promoting.

---

## Typical Workflows

### Search and explore

```
1. knowledge_query("how to register repositories")   -- find relevant chunks
2. knowledge_list(filters: { domain: "dependency-injection" })  -- browse a domain
```

### Update stale knowledge

```
1. knowledge_list(filters: { source: "path/to/file.md" })  -- find existing chunks
2. Read the file (Claude's Read tool)                        -- get current content
3. knowledge_evolve(id, new_content, reason)                 -- update changed chunks
4. knowledge_delete(id)                                      -- remove deleted sections
5. knowledge_store(content, metadata)                        -- add new sections
```

### Validate and promote

```
1. knowledge_validate(id, "confirm", evidence: "Confirmed in src/config.ts:42")  -- confirm with evidence
2. knowledge_validate(id, "confirm", evidence: "Tests pass in scripts/regression-test.ts")  -- confirm again
3. knowledge_validate(id, "confirm", evidence: "Documented in docs/architecture.md")  -- third confirmation
   -- chunk auto-promotes to "validated" (conf >= 0.85, 3 validations)
4. Verify all 4 golden evidence sources exist (docs, code, tests, task)
5. knowledge_promote(id, reason: "Golden Evidence: [docs:...] [code:...] [tests:...] [task:...]")
```

### Link related knowledge

```
1. knowledge_store(content, metadata)                        -- store the rule
2. knowledge_link(source_id, target_id, "depends_on")        -- link to related rules
```
