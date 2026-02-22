# Metadata Schema Reference

Complete reference for all metadata fields accepted by the knowledge-graph MCP server. Use this to look up types, constraints, and validation behavior for any field.

---

## 1. ChunkMetadata

Passed as the `metadata` parameter to `knowledge_store` and partially to `knowledge_evolve`.

| Field | Type | Required | Constraints | Default |
|-------|------|----------|-------------|---------|
| `summary` | string | YES | min 1, max 200 chars (configurable via `limits.maxSummaryLength`) | -- |
| `keywords` | string[] | YES | 1-15 items, each min 2 chars (enforced by Zod) | -- |
| `domain` | string | YES | max 50 chars (enforced by Zod), kebab-case recommended | -- |
| `category` | enum | YES | `rule` \| `pattern` \| `example` \| `reference` \| `learning` \| `workflow` \| `concept` | -- |
| `importance` | enum | YES | `critical` \| `high` \| `medium` \| `low` | -- |
| `entities` | string[] | no | min 2 chars each, deduplicated | `[]` |
| `suggested_relations` | SuggestedRelation[] | no | see [Section 4](#4-suggestedrelation) | -- |
| `tags` | string[] | no | kebab-case enforced, deduplicated | `[]` |
| `source` | string | no | trimmed, origin file path or identifier | `null` |
| `code_refs` | CodeRef[] | no | see [Section 2](#2-coderef) | -- |

### Content (sibling to metadata)

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `content` | string | YES | max 5000 chars (configurable via `limits.maxContentLength`) |

---

## 2. CodeRef

Nested object within `metadata.code_refs[]`. Links a knowledge chunk to a code entity.

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | YES | entity name (class, function, file), trimmed |
| `entity_type` | enum | YES | `class` \| `method` \| `function` \| `interface` \| `file` \| `mixin` \| `enum` \| `widget` \| `cubit` \| `repository` \| `use-case` \| `test-file` \| `factory` \| `extension` \| `constant` \| `type-alias` \| `screen` \| `route` \| `inject-module` |
| `file_path` | string | YES | min 1 char (enforced by Zod), must not be empty |
| `line_start` | number | no | starting line number |
| `layer` | enum | no | `presentation` \| `domain` \| `data` \| `core` \| `test` |
| `feature` | string | no | feature name, trimmed |
| `signature` | string | no | type signature, trimmed |
| `relation` | enum | YES | `implemented_by` \| `tested_by` \| `demonstrated_in` \| `depends_on` \| `implements` \| `injects` |
| `via` | string | no | how the relation is established (e.g., "GetIt factory"), trimmed |
| `description` | string | no | human-readable description of the link, trimmed |

### entity_type enum values (enforced by Zod)

`class`, `method`, `function`, `interface`, `file`, `mixin`, `enum`, `widget`, `cubit`, `repository`, `use-case`, `test-file`, `factory`, `extension`, `constant`, `type-alias`, `screen`, `route`, `inject-module`

Unknown values are rejected with a Zod validation error.

### Relation edge behavior

Only 3 relations create Chunk-to-CodeEntity edges in the graph database:

| Relation | Creates Chunk->CodeEntity edge |
|----------|-------------------------------|
| `implemented_by` | YES |
| `tested_by` | YES |
| `demonstrated_in` | YES |
| `depends_on` | NO -- accepted by schema but no edge created |
| `implements` | NO -- accepted by schema but no edge created |
| `injects` | NO -- accepted by schema but no edge created |

---

## 3. Validation Rules

### Blocking (request rejected by Zod)

| Condition | Error |
|-----------|-------|
| `content` is empty | String must contain at least 1 character |
| `content` > 5000 chars | String must contain at most 5000 characters |
| `summary` is empty | String must contain at least 1 character |
| `summary` > 200 chars | String must contain at most 200 characters |
| `keywords` is empty array | Array must contain at least 1 element |
| `keywords` > 15 items | Array must contain at most 15 elements |
| Any keyword < 2 chars | String must contain at least 2 characters |
| Any entity < 2 chars | String must contain at least 2 characters |
| `domain` is missing | Required field |
| `domain` > 50 chars | String must contain at most 50 characters |
| `category` not in enum | Invalid enum value |
| `importance` not in enum | Invalid enum value |
| `code_refs[].entity_type` not in enum | Invalid enum value (19 accepted values) |
| `code_refs[].file_path` is empty | String must contain at least 1 character |
| `code_refs[].relation` not in enum | Invalid enum value |
| `code_refs[].layer` not in enum (if provided) | Invalid enum value |
| `filters.category` not in enum (query/list) | Invalid enum value |
| `filters.importance` not in enum (query/list) | Invalid enum value |

### Warnings (non-blocking)

The validator returns warnings that don't prevent storage but indicate potential issues:

| Condition | Warning |
|-----------|---------|
| `entity_type` unusual for `layer` | `entity_type "X" is unusual for layer "Y"` |
| `relation` won't create edge | `relation "X" does not create a Chunk→CodeEntity edge` |

Warnings are returned in the `warnings[]` array of both `knowledge_store` and `knowledge_link_code` responses.

### Semantic deduplication

If content is semantically near-identical to an existing chunk (cosine similarity >= 0.95), `knowledge_store` returns the existing chunk ID along with `duplicate_of`, `similarity`, and `existing_summary` fields. This catches paraphrased or reformatted content, not just byte-identical duplicates.

### Auto-normalization (silent)

| What | Normalization |
|------|--------------|
| Keywords | Lowercased, deduplicated |
| Tags | Normalized to kebab-case, deduplicated |
| Entities | Deduplicated |
| Source | Trimmed |
| CodeRef string fields | Trimmed |

---

## 4. SuggestedRelation

Nested object within `metadata.suggested_relations[]`. Hints at connections to other chunks.

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `concept` | string | YES | name or description of the related concept |
| `relation` | enum | YES | `relates_to` \| `depends_on` \| `contradicts` |

The linker attempts to match the `concept` string to existing chunks using:
1. Domain match (score 0.9)
2. Keyword match (score 0.7)
3. Embedding similarity match (score >= 0.5)

If a match is found, the specified relationship is created automatically.

---

## 5. knowledge_evolve Metadata

When calling `knowledge_evolve`, `new_metadata` is optional and all fields within it are optional. Only provided fields are updated; others retain their existing values.

| Field | Type | Required | Same constraints as ChunkMetadata |
|-------|------|----------|----------------------------------|
| `summary` | string | no | max 200 chars |
| `keywords` | string[] | no | -- |
| `domain` | string | no | -- |
| `category` | enum | no | same 7 values |
| `importance` | enum | no | same 4 values |
| `entities` | string[] | no | -- |
| `suggested_relations` | SuggestedRelation[] | no | -- |
| `tags` | string[] | no | -- |

Note: `code_refs` and `source` are NOT available in `knowledge_evolve`. To update code links after evolve, use `knowledge_link_code`.

---

## 6. QueryFilters

Used with `knowledge_query` to narrow search results.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | no | Filter by domain |
| `category` | string | no | Filter by category |
| `importance` | string | no | Filter by importance |
| `tags` | string[] | no | Filter by tags |
| `limit` | number | no | Max results (default: 10) |

---

## 7. ListFilters

Used with `knowledge_list` to browse chunks.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | no | Filter by domain |
| `category` | string | no | Filter by category |
| `importance` | string | no | Filter by importance |
| `tags` | string[] | no | Filter by tags |
| `source` | string | no | Filter by source path |

Default limit: 50 results.

---

## 8. Examples

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
    "source": "CLAUDE.md",
    "code_refs": [
      {
        "name": "FirestoreProductRepository",
        "entity_type": "repository",
        "file_path": "lib/features/product/data/repositories/firestore_product_repository.dart",
        "line_start": 15,
        "layer": "data",
        "feature": "product",
        "relation": "implemented_by",
        "description": "Repository that requires userId and storeId at construction time"
      }
    ]
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
