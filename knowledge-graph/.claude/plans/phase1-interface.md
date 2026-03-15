# Phase 1: Extract IStorage Interface and Refactor KuzuStorage

## Goal
Create a storage abstraction layer so KuzuStorage can be swapped with other backends (e.g., SurrealDB). No behavior changes — pure refactoring.

## 1. New File: `src/storage/interface.ts`

### IStorage Interface (16 public methods)

All 16 public methods from KuzuStorage, with one simplification: `createRelation()` drops `fromTable`/`toTable` params since they're always `'Chunk'`.

```typescript
import { StoredChunk, GraphEdge, QueryFilters, ListFilters } from '../types.js';

export interface IStorage {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Chunk CRUD
  createChunk(chunk: Omit<StoredChunk, 'created_at' | 'updated_at'>): Promise<string>;
  getChunk(id: string): Promise<StoredChunk | null>;
  updateChunk(id: string, updates: Partial<StoredChunk>): Promise<void>;
  deleteChunk(id: string): Promise<void>;
  listChunks(filters: ListFilters, limit?: number): Promise<StoredChunk[]>;

  // Relationships
  createRelation(fromId: string, toId: string, relType: string, props?: Record<string, string>): Promise<void>;
  deleteAutoRelations(chunkId: string): Promise<void>;

  // Search
  vectorSearch(embedding: number[], k: number, filters?: QueryFilters): Promise<Array<{ chunk: StoredChunk; distance: number }>>;
  vectorSearchUnfiltered(embedding: number[], k: number): Promise<Array<{ chunk: StoredChunk; distance: number }>>;
  getRelatedChunks(chunkId: string, depth?: number): Promise<StoredChunk[]>;
  findChunksByDomain(domain: string): Promise<StoredChunk[]>;
  findChunksByKeyword(keyword: string): Promise<StoredChunk[]>;

  // Dashboard / Stats
  getAllEdges(): Promise<GraphEdge[]>;
  getStats(): Promise<{ total_chunks: number; total_edges: number; by_domain: Record<string, number>; by_category: Record<string, number>; by_importance: Record<string, number> }>;

  // Access tracking
  incrementAccessCount(ids: string[]): Promise<void>;
}

export type StorageBackend = 'kuzu' | 'surrealdb';

export async function createStorage(backend: StorageBackend, dbPath: string): Promise<IStorage> {
  switch (backend) {
    case 'kuzu': {
      const { KuzuStorage } = await import('./kuzu.js');
      return new KuzuStorage(dbPath);
    }
    default:
      throw new Error(`Unknown storage backend: ${backend}`);
  }
}
```

### Key Design Decisions

- **`deleteRelationsForNode()` excluded**: Only used internally by `updateChunk()` (save/restore pattern). Not part of the public contract.
- **`saveChunkRelations()` / `restoreChunkRelations()` excluded**: Private methods, KuzuDB-specific workaround for vector-indexed column limitation.
- **`getStats()` return type**: Returns the storage-level stats only (5 fields). `StorageStats` includes `cache_size` and `cache_max` which come from `Embedder`, not storage. Dashboard's `handleStats()` already merges them.
- **`createRelation()` simplified**: Removes `fromTable`/`toTable` params since the schema is always Chunk-to-Chunk. Internal KuzuDB implementation will hardcode `'Chunk'`.

## 2. Changes to `src/storage/kuzu.ts`

1. Add `import { IStorage } from './interface.js';` at top
2. Change class declaration: `export class KuzuStorage implements IStorage`
3. **Simplify `createRelation()` signature**: Remove `fromTable` and `toTable` params, hardcode `'Chunk'` in the method body
4. **Update internal callers of `createRelation()`**: `restoreChunkRelations()` currently passes `fromTable`/`toTable` — update to drop those params since they'll be hardcoded

### `createRelation()` before:
```typescript
async createRelation(fromId, toId, relType, fromTable, toTable, props?) { ... }
```

### `createRelation()` after:
```typescript
async createRelation(fromId: string, toId: string, relType: string, props?: Record<string, string>): Promise<void> {
  const entries = props ? Object.entries(props) : [];
  const propsClause = entries.length > 0
    ? ` {${entries.map(([k, v]) => `${k}: '${v.replace(/'/g, "''")}'`).join(', ')}}`
    : '';
  await this.queryParams(
    `MATCH (a:Chunk), (b:Chunk)
     WHERE a.id = $fromId AND b.id = $toId
     CREATE (a)-[:${relType}${propsClause}]->(b)`,
    { fromId, toId },
  );
}
```

### `restoreChunkRelations()` change:
```typescript
// Before:
await this.createRelation(chunkId, rel.otherId, rel.relType, 'Chunk', rel.otherTable, rel.props);
// After:
await this.createRelation(chunkId, rel.otherId, rel.relType, rel.props);
```

Both outgoing and incoming calls in `restoreChunkRelations()` need updating (2 call sites).

## 3. File-by-File Changes for IStorage Type

### Files that import KuzuStorage and need to change to IStorage:

| # | File | Current Import | Change |
|---|------|---------------|--------|
| 1 | `src/core.ts` | `KuzuStorage` (import + `CoreComponents` type + `new KuzuStorage()`) | Import `IStorage` + `createStorage`, change `CoreComponents.storage` to `IStorage`, replace `new KuzuStorage(db.path)` with `await createStorage('kuzu', db.path)` |
| 2 | `src/engine/retriever.ts` | `KuzuStorage` (import + constructor param) | Import `IStorage` from `../storage/interface.js`, change constructor param type |
| 3 | `src/engine/linker.ts` | `KuzuStorage` (import + constructor param) | Import `IStorage` from `../storage/interface.js`, change constructor param type |
| 4 | `src/tools/store.ts` | `KuzuStorage` (import + function param) | Import `IStorage`, change `storage` param type |
| 5 | `src/tools/validate.ts` | `KuzuStorage` (import + function param) | Import `IStorage`, change `storage` param type |
| 6 | `src/tools/promote.ts` | `KuzuStorage` (import + function param) | Import `IStorage`, change `storage` param type |
| 7 | `src/tools/evolve.ts` | `KuzuStorage` (import + function param) | Import `IStorage`, change `storage` param type |
| 8 | `src/tools/link.ts` | `KuzuStorage` (import + function param) | Import `IStorage`, change `storage` param type |
| 9 | `src/tools/delete.ts` | `KuzuStorage` (import + function param) | Import `IStorage`, change `storage` param type |
| 10 | `src/tools/list.ts` | `KuzuStorage` (import + function param) | Import `IStorage`, change `storage` param type |
| 11 | `src/dashboard/api.ts` | `KuzuStorage` (import + function params) | Import `IStorage`, change all `storage` param types (4 functions) |
| 12 | `src/dashboard/server.ts` | `KuzuStorage` (import + constructor param) | Import `IStorage`, change constructor param type |
| 13 | `scripts/regression-test.ts` | `KuzuStorage` (import + variable type + `new KuzuStorage()`) | Import `IStorage` + `createStorage` from interface, change `storage` variable type to `IStorage`, replace `new KuzuStorage(testDbPath)` with `await createStorage('kuzu', testDbPath)` |

### Files that need `createRelation()` call site updates (remove 'Chunk','Chunk' args):

| # | File | Lines | Change |
|---|------|-------|--------|
| 1 | `src/engine/linker.ts` | Lines 43-49, 72-77 | Remove `'Chunk', 'Chunk'` from 2 call sites |
| 2 | `src/tools/evolve.ts` | Lines 67-74 | Remove `'Chunk', 'Chunk'` from 1 call site |
| 3 | `src/tools/link.ts` | Line 24 | Remove `'Chunk', 'Chunk'` from 1 call site |

### Files NOT changed:
- `src/daemon.ts` — does not import `KuzuStorage` directly. Uses `CoreComponents` from `core.ts` which will automatically pick up the `IStorage` type.
- `src/tools/query.ts` — uses `Retriever`, not `KuzuStorage` directly.
- `src/client.ts` — MCP proxy, no storage interaction.
- `src/daemon-manager.ts` — process management, no storage interaction.

## 4. Verification

1. Run `npm run build` — must compile with zero errors
2. Confirm no runtime behavior changes (pure type refactoring + `createRelation()` param simplification)

## 5. Summary of Deliverables

- 1 new file: `src/storage/interface.ts`
- 14 modified files (kuzu.ts + 13 callers)
- Zero behavioral changes
- `createRelation()` simplified: 4 external call sites drop `'Chunk','Chunk'` + 2 internal call sites in `restoreChunkRelations()`
