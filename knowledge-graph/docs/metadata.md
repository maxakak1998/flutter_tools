# Metadata Schema Reference

Complete reference for all metadata fields accepted by the knowledge-graph MCP server. Use this to look up types, constraints, and validation behavior for any field.

---

## 1. ChunkMetadata

Passed as the `metadata` parameter to `knowledge_store` and partially to `knowledge_evolve`.

| Field | Type | Required | Constraints | Default |
|-------|------|----------|-------------|---------|
| `summary` | string | YES | min 1, max 200 chars (enforced by Zod) | -- |
| `keywords` | string[] | YES | 1-15 items, each min 2 chars (enforced by Zod) | -- |
| `domain` | string | YES | max 50 chars (enforced by Zod), no min length (empty string passes Zod), auto-normalized to kebab-case on store | -- |
| `category` | enum | YES | `fact` \| `rule` \| `insight` \| `question` \| `workflow` | -- |
| `importance` | enum | YES | `critical` \| `high` \| `medium` \| `low` | -- |
| `entities` | string[] | no | min 2 chars each, deduplicated | `[]` |
| `suggested_relations` | SuggestedRelation[] | no | see [Section 3](#3-suggestedrelation) | -- |
| `tags` | string[] | no | kebab-case enforced, deduplicated | `[]` |
| `source` | string | no | trimmed, origin file path or identifier | `null` |
| `layer` | string | no | auto-inferred from category if omitted | inferred |

### Content (sibling to metadata)

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `content` | string | YES | Zod hard limit 5000 chars (in `client.ts`); per-category size warnings in `store.ts` (fact: 500, rule: 800, insight: 600, question: 400, workflow: 800) |

---

## 2. Validation Rules

### Blocking (request rejected by Zod)

| Condition | Error |
|-----------|-------|
| `content` is empty | String must contain at least 1 character (Zod hard limit in `client.ts`) |
| `content` > 5000 chars | String must contain at most 5000 characters (Zod hard limit in `client.ts`) |
| `summary` is empty | String must contain at least 1 character |
| `summary` > 200 chars | String must contain at most 200 characters |
| `keywords` is empty array | Array must contain at least 1 element |
| `keywords` > 15 items | Array must contain at most 15 elements |
| Any keyword < 2 chars | String must contain at least 2 characters |
| Any entity < 2 chars | String must contain at least 2 characters |
| `domain` is missing | Required field (but empty string passes — Zod has no `.min(1)`) |
| `domain` > 50 chars | String must contain at most 50 characters |
| `category` not in enum | Invalid enum value |
| `importance` not in enum | Invalid enum value |
| `filters.category` not in enum (query/list) | Invalid enum value |
| `filters.importance` not in enum (query/list) | Invalid enum value |

Warnings are returned in the `warnings[]` array of the `knowledge_store` response (e.g., content size exceeding category targets).

### Semantic deduplication

If content is semantically near-identical to an existing chunk (cosine similarity >= dedup threshold, default 0.88), `knowledge_store` returns the existing chunk ID along with `duplicate_of`, `similarity`, and `existing_summary` fields. This catches paraphrased or reformatted content, not just byte-identical duplicates.

### Auto-normalization (silent)

| What | Normalization |
|------|--------------|
| Domain | Kebab-case (e.g., "State Management" → "state-management") |
| Keywords | Lowercased, deduplicated |
| Tags | Normalized to kebab-case, deduplicated |
| Entities | Deduplicated, filtered to 2+ chars |
| Source | Trimmed |

---

## 3. SuggestedRelation

Nested object within `metadata.suggested_relations[]`. Hints at connections to other chunks.

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `concept` | string | YES | name or description of the related concept |
| `relation` | enum | YES | `relates_to` \| `depends_on` \| `contradicts` \| `triggers` \| `requires` \| `produces` \| `is_part_of` \| `constrains` \| `precedes` \| `transitions_to` \| `governed_by` |

Note: `supersedes` is intentionally excluded from suggested relations. Supersedes edges are system-managed — created automatically by `knowledge_evolve` when archiving old versions. Use `knowledge_link` to create manual `supersedes` edges.

The linker attempts to match the `concept` string to existing chunks using:
1. Domain match (score 0.9)
2. Keyword match (score 0.7)
3. Embedding similarity match (score >= 0.5)

If a match is found, the specified relationship is created automatically.

---

## 4. knowledge_evolve Metadata

When calling `knowledge_evolve`, `new_metadata` is optional and all fields within it are optional. Only provided fields are updated; others retain their existing values.

All provided metadata fields are normalized using the same rules as `knowledge_store` (domain→kebab-case, keywords→lowercased+deduplicated, tags→kebab-case+deduplicated, entities→deduplicated+filtered to 2+ chars). When `category` changes and no explicit `layer` is provided, the layer is automatically re-inferred from the new category.

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `summary` | string | no | min 1, max 200 chars |
| `keywords` | string[] | no | 1–15 items, each min 2 chars (same as store) |
| `domain` | string | no | max 50 chars (same as store) |
| `category` | enum | no | same 5 values |
| `importance` | enum | no | same 4 values |
| `layer` | string | no | auto-inferred from category if omitted and category changed |
| `entities` | string[] | no | Min 2 chars each (same as store), also filtered to 2+ chars during normalization |
| `suggested_relations` | SuggestedRelation[] | no | same as store |
| `tags` | string[] | no | same as store |

Note: `source` is NOT available in `knowledge_evolve`.

---

## 5. QueryFilters

Used with `knowledge_query` to narrow search results.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | no | Filter by domain |
| `category` | enum | no | Filter by category |
| `importance` | enum | no | Filter by importance |
| `tags` | string[] | no | Filter by tags |
| `layer` | string | no | Filter by layer |
| `min_confidence` | number | no | Min effective confidence (0.0-1.0, applies temporal decay) |
| `lifecycle` | enum | no | `hypothesis` \| `validated` \| `promoted` \| `canonical` \| `refuted` \| `active` |
| `since` | string | no | ISO timestamp — only chunks updated after this date |

Tag filtering uses OR logic — chunks matching **any** of the listed tags are included.

---

## 6. ListFilters

Used with `knowledge_list` to browse chunks.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | no | Filter by domain |
| `category` | enum | no | Filter by category |
| `importance` | enum | no | Filter by importance |
| `tags` | string[] | no | Filter by tags |
| `source` | string | no | Filter by source path |
| `layer` | string | no | Filter by layer |
| `min_confidence` | number | no | Min effective confidence (0.0-1.0) |
| `lifecycle` | enum | no | `hypothesis` \| `validated` \| `promoted` \| `canonical` \| `refuted` \| `active` |
| `since` | string | no | ISO timestamp — only chunks updated after this date |

Tag filtering uses OR logic — chunks matching **any** of the listed tags are included.

Default limit: 50 results.

---

## 7. Examples

### Valid metadata (complete)

```json
{
  "content": "In multi-tenant Flutter apps using Clean Architecture, repositories MUST be registered as factories in GetIt, never as lazy singletons. The factory receives userId and storeId at call time, ensuring each tenant gets isolated data access.\n\n```dart\nsl.registerFactory<IProductRepository Function(String, String)>(\n  () => (userId, storeId) => FirestoreProductRepository(\n    userId: userId,\n    storeId: storeId,\n  ),\n);\n```\n\nUsing registerLazySingleton would bind the repository to the first tenant's credentials, causing data leaks between tenants.",
  "metadata": {
    "summary": "Factory DI pattern for multi-tenant repository registration in GetIt",
    "keywords": ["registerFactory", "multi-tenant", "userId", "storeId", "repository", "GetIt", "lazy-singleton"],
    "domain": "dependency-injection",
    "category": "rule",
    "importance": "critical",
    "entities": ["GetIt", "IProductRepository", "FirestoreProductRepository"],
    "suggested_relations": [
      { "concept": "clean architecture layer rules", "relation": "depends_on" },
      { "concept": "cubit creation in BlocProvider", "relation": "relates_to" }
    ],
    "tags": ["multi-tenant", "security"],
    "source": "CLAUDE.md"
  }
}
```

### Minimal valid metadata

```json
{
  "content": "Always use context.tr() for localized strings. Never hardcode user-visible text.",
  "metadata": {
    "summary": "Use context.tr() for all user-visible strings",
    "keywords": ["context-tr", "localization", "hardcode"],
    "domain": "localization",
    "category": "rule",
    "importance": "medium"
  }
}
```
