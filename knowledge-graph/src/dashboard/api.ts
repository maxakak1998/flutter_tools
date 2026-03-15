import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Retriever } from '../engine/retriever.js';
import { StorageStats, QueryFilters, log } from '../types.js';

/**
 * Get full graph data for vis-network visualization.
 * Returns nodes (chunks) and edges.
 */
export async function handleGraphData(storage: IStorage, embedder: Embedder) {
  const [chunks, edges] = await Promise.all([
    storage.listChunks({}, 500),
    storage.getAllEdges(),
  ]);

  // Map chunks to vis-network nodes (exclude embedding for bandwidth)
  const chunkNodes = chunks.map(c => ({
    id: c.id,
    label: c.summary,
    title: c.summary,
    type: 'chunk',
    category: c.category,
    importance: c.importance,
    domain: c.domain,
    layer: c.layer,
    version: c.version,
    confidence: c.confidence,
    lifecycle: c.lifecycle,
  }));

  const visEdges = edges.map((e, i) => ({
    id: `edge-${i}`,
    from: e.from,
    to: e.to,
    relation: e.relation,
    auto_created: e.auto_created,
  }));

  return {
    nodes: chunkNodes,
    edges: visEdges,
  };
}

/**
 * Get aggregate stats for dashboard display.
 */
export async function handleStats(storage: IStorage, embedder: Embedder): Promise<StorageStats> {
  const stats = await storage.getStats();
  const cacheStats = embedder.getCacheStats();

  return {
    ...stats,
    cache_size: cacheStats.size,
    cache_max: cacheStats.maxSize,
  };
}

/**
 * Search knowledge base via HTTP GET with query params.
 * Delegates to Retriever.search() for full hybrid search pipeline.
 */
export async function handleSearch(
  retriever: Retriever,
  query: string,
  filters?: QueryFilters,
) {
  return retriever.search(query, filters);
}

/**
 * Get detailed info for a single chunk (for node click detail panel).
 */
export async function handleChunkDetail(storage: IStorage, id: string) {
  const chunk = await storage.getChunk(id);
  if (!chunk) return null;

  const relatedChunks = await storage.getRelatedChunks(id, 1);

  return {
    ...chunk,
    embedding: undefined, // Don't send 1024-dim vector to browser
    related_chunks: relatedChunks.map(r => ({
      id: r.id,
      summary: r.summary,
      category: r.category,
      domain: r.domain,
    })),
  };
}
