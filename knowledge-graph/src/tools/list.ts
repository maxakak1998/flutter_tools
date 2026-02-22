import { KuzuStorage } from '../storage/kuzu.js';
import { ListFilters, StoredChunk } from '../types.js';

interface ListResult {
  chunks: Array<{
    id: string;
    summary: string;
    domain: string;
    category: string;
    importance: string;
    layer: string | null;
    source: string | null;
    version: number;
    updated_at: string;
    tags: string[];
  }>;
  total: number;
}

export async function handleList(
  storage: KuzuStorage,
  filters: ListFilters,
  limit = 50
): Promise<ListResult> {
  const chunks = await storage.listChunks(filters, limit);

  return {
    chunks: chunks.map((c: StoredChunk) => ({
      id: c.id,
      summary: c.summary,
      domain: c.domain,
      category: c.category,
      importance: c.importance,
      layer: c.layer,
      source: c.source,
      version: c.version,
      updated_at: c.updated_at,
      tags: c.tags,
    })),
    total: chunks.length,
  };
}
