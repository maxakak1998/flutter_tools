# Plan: SurrealDB Storage Backend Implementation

## Goal
Create `src/storage/surreal.ts` implementing the `IStorage` interface (16 methods) using SurrealDB in embedded mode, and wire it into the `createStorage` factory.

## Prerequisites
- Phase 1 complete: `IStorage` interface exists at `src/storage/interface.ts`
- Phase 2 (in progress by config-cli): storage backend config and CLI flag

## Dependencies to Install
- `surrealdb` — SurrealDB JS SDK
- `@surrealdb/node` — Node.js native bindings for embedded mode

```bash
npm install surrealdb @surrealdb/node
```

## File Changes

### 1. Create `src/storage/surreal.ts` (~400 lines)

#### Connection Setup
```typescript
import { Surreal, RecordId, Table } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
```
- Create `Surreal` instance with `createNodeEngines()`
- Connect via `surrealkv://${dbPath}`
- Use namespace `'knowledge'`, database `'graph'`
- No authentication needed for embedded mode

#### RecordId Helper
SurrealDB returns `RecordId` objects (e.g., `chunk:abc123`), not plain strings. Need an `extractId()` helper:
```typescript
function extractId(rid: unknown): string {
  if (rid instanceof RecordId) return String(rid.id);
  const s = String(rid);
  const idx = s.indexOf(':');
  return idx >= 0 ? s.slice(idx + 1) : s;
}
```

#### Relation Table Name Mapping
`REQUIRES` is a reserved word in SurrealDB. Map all 15 relation types to SurrealDB table names:
```typescript
const SURREAL_REL_TABLE: Record<string, string> = {
  RELATES_TO: 'relates_to',
  DEPENDS_ON: 'depends_on',
  CONTRADICTS: 'contradicts',
  SUPERSEDES: 'supersedes',
  TRIGGERS: 'triggers',
  REQUIRES: 'requires_rel',    // REQUIRES is reserved in SurrealDB
  PRODUCES: 'produces',
  IS_PART_OF: 'is_part_of',
  CONSTRAINS: 'constrains',
  PRECEDES: 'precedes',
  IS_TRUE: 'is_true',
  IS_FALSE: 'is_false',
  TRANSITIONS_TO: 'transitions_to',
  MUTATES: 'mutates',
  GOVERNED_BY: 'governed_by',
};
```
Also need a reverse map (`surrealRelToKuzu`) for converting back when reading edges from DB.

#### Schema Definition (`initialize()`)
1. Create parent directory with `mkdirSync`
2. Connect to embedded SurrealDB
3. Define SCHEMAFULL `chunk` table with all 24 fields:
   - `id` (auto from record ID)
   - `content`, `summary` — `type string`
   - `embedding` — `type array<float>` (1024 dims)
   - `source` — `type option<string>` (nullable)
   - `category`, `domain`, `importance` — `type string`
   - `layer` — `type option<string>` (default `'core-knowledge'`)
   - `keywords`, `entities`, `tags` — `type array<string>`
   - `created_at`, `updated_at` — `type string`
   - `version` — `type int` (default 1)
   - `confidence` — `type float` (default 0.5)
   - `validation_count`, `refutation_count`, `access_count` — `type int` (default 0)
   - `last_validated_at` — `type string` (default `''`)
   - `lifecycle` — `type string` (default `'active'`)
4. Define HNSW vector index:
   ```surql
   DEFINE INDEX IF NOT EXISTS idx_chunk_embedding ON chunk FIELDS embedding HNSW DIMENSION 1024 DIST COSINE
   ```
5. Define 15 relation tables (TYPE RELATION FROM chunk TO chunk):
   - Each with `description` (string) and `auto_created` (string) properties
   - `supersedes` gets `reason` (string) instead of `description`
   - `requires_rel` used instead of `requires`

#### Method-by-Method Implementation

**`createChunk(chunk)`**
- Generate timestamps
- Use `db.query()` with `CREATE chunk:$id CONTENT {...}` passing all fields as parameters
- Return chunk.id

**`getChunk(id)`**
- `SELECT * FROM chunk:$id` via `db.query()`
- Map result row to `StoredChunk` using `rowToChunk()` helper
- Handle RecordId extraction for the `id` field
- Return null if no result

**`updateChunk(id, updates)`**
- No KuzuDB workaround needed — SurrealDB supports direct UPDATE on vector-indexed fields
- Build `UPDATE chunk:$id SET field = $value, ...` for each non-undefined field in updates
- Always set `updated_at` to current timestamp

**`deleteChunk(id)`**
- Delete edges from all 15 relation tables where `in` or `out` matches `chunk:$id`
- Then `DELETE chunk:$id`
- Use a loop over all relation table names

**`listChunks(filters, limit)`**
- Build `SELECT * FROM chunk WHERE ...` with filter conditions
- Domain filter uses `= $domain OR string::starts_with(domain, $domainPrefix)`
- Tags filter: post-filter in JS (array containment is awkward in SurrealQL)
- Apply `LIMIT $limit`
- Map results to `StoredChunk[]`

**`createRelation(fromId, toId, relType, props?)`**
- Map `relType` (UPPERCASE like `RELATES_TO`) to SurrealDB table name via `SURREAL_REL_TABLE`
- Use `RELATE chunk:$fromId -> $table -> chunk:$toId SET ...` with props
- Props include `auto_created`, `description`, `reason` as applicable

**`deleteAutoRelations(chunkId)`**
- Query `relates_to` edges where `auto_created = 'true'` and `in` or `out` is `chunk:$id`
- Delete matching edges: `DELETE relates_to WHERE (in = chunk:$id OR out = chunk:$id) AND auto_created = 'true'`

**`vectorSearch(embedding, k, filters?)`**
- Use KNN operator: `SELECT *, vector::distance::knn() AS distance FROM chunk WHERE embedding <|$k, COSINE|> $vec`
- Apply post-filters in JS (same pattern as KuzuDB — domain, category, importance, layer, tags, min_confidence, lifecycle, since)
- Map results to `{ chunk: StoredChunk, distance: number }[]`

**`vectorSearchUnfiltered(embedding, k)`**
- Same as vectorSearch but no filters — simpler query

**`getRelatedChunks(chunkId, depth)`**
- For each of the 15 relation types, query outgoing and incoming edges
- Use arrow syntax: `SELECT * FROM chunk:$id->$relTable->chunk` and `SELECT * FROM chunk:$id<-$relTable<-chunk`
- Collect all unique related chunks (deduplicate by id)
- For depth > 1, recursively expand (or use SurrealDB's recursive traversal if available)
- Simpler approach: for depth=1 just do direct neighbors; for depth=2 do 2-level traversal per relation

**`findChunksByDomain(domain)`**
- `SELECT * FROM chunk WHERE domain = $domain`

**`findChunksByKeyword(keyword)`**
- `SELECT * FROM chunk WHERE string::contains(string::lowercase(content), $kw) OR string::contains(string::lowercase(summary), $kw)`

**`getAllEdges()`**
- For each of the 15 relation table names, query all edges
- `SELECT in, out, auto_created FROM $table`
- Extract IDs from RecordId objects, map to `GraphEdge[]`

**`getStats()`**
- `SELECT count() FROM chunk GROUP ALL` for total chunks
- Sum edge counts across all 15 relation tables
- `SELECT domain, count() FROM chunk GROUP BY domain` for by_domain
- Same pattern for by_category, by_importance

**`incrementAccessCount(ids)`**
- For each id: `UPDATE chunk:$id SET access_count += 1`

**`close()`**
- `await db.close()`

#### Row Mapping Helper (`rowToChunk`)
SurrealDB returns objects with fields directly (not prefixed like KuzuDB's `c.id`). The `id` field is a `RecordId` object that needs `extractId()`. Arrays (`keywords`, `entities`, `tags`) should come back as native JS arrays. Numeric fields need `Number()` coercion for safety.

### 2. Update `src/storage/interface.ts` — Add surreal case to `createStorage`

```typescript
case 'surreal': {
  const { SurrealStorage } = await import('./surreal.js');
  storage = new SurrealStorage(dbPath);
  break;
}
```

## Distance Semantics
- SurrealDB's `vector::distance::knn()` with COSINE returns cosine **distance** (0 = identical, 2 = opposite)
- This matches the existing system — KuzuDB's cosine vector index also returns cosine distance
- The retriever converts distance to similarity: `similarity = 1 - distance`
- No conversion needed in the storage layer

## Error Handling Strategy
- Schema definitions use `IF NOT EXISTS` / `OVERWRITE` where SurrealDB supports it
- Wrap schema creation in try-catch, ignore "already exists" errors (same pattern as KuzuDB)
- Use `log()` from `types.ts` for all logging (never `console.log`)

## Testing Strategy
- After implementation, run `bash install.sh` to sync build
- Use the existing regression test suite at `scripts/regression-test.ts`
- Manual verification: `kg init`, store/query/list/evolve/validate/promote/link/delete operations
