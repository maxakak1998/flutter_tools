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

export type StorageBackend = 'kuzu' | 'surreal';

export async function createStorage(backend: StorageBackend, dbPath: string): Promise<IStorage> {
  let storage: IStorage;
  switch (backend) {
    case 'kuzu': {
      const { KuzuStorage } = await import('./kuzu.js');
      storage = new KuzuStorage(dbPath);
      break;
    }
    case 'surreal': {
      const { SurrealStorage } = await import('./surreal.js');
      storage = new SurrealStorage(dbPath);
      break;
    }
    default:
      throw new Error(`Unknown storage backend: ${backend}`);
  }
  await storage.initialize();
  return storage;
}
