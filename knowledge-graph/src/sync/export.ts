import { join } from 'path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { IStorage } from '../storage/interface.js';
import { StoredChunk, GraphEdge, log } from '../types.js';
import {
  SyncChunkFile,
  SyncEdgeFile,
  SyncManifest,
  computeContentHash,
  computeEdgeHash,
  stableStringify,
} from './format.js';

// ============================================================
// Layers excluded from sync (operational/derived data)
// ============================================================

const EXCLUDED_LAYERS = ['operational', 'entity-index'];

// ============================================================
// Single-chunk export
// ============================================================

/**
 * Map a StoredChunk to the sync file format.
 * Strips: embedding, confidence, validation_count, refutation_count,
 *         access_count, last_validated_at, id (local DB key).
 * Keeps: sync_id, content, metadata, lifecycle, version, timestamps.
 */
export function exportChunk(chunk: StoredChunk): SyncChunkFile {
  return {
    sync_id: chunk.sync_id,
    version: chunk.version,
    content_hash: computeContentHash(chunk.content),
    content: chunk.content,
    summary: chunk.summary,
    domain: chunk.domain,
    category: chunk.category,
    importance: chunk.importance,
    layer: chunk.layer,
    keywords: chunk.keywords,
    entities: chunk.entities,
    tags: chunk.tags,
    lifecycle: chunk.lifecycle,
    source: chunk.source,
    created_at: chunk.created_at,
    updated_at: chunk.updated_at,
  };
}

// ============================================================
// Single-edge export
// ============================================================

/**
 * Map a GraphEdge to the sync file format.
 * Only exports edges where auto_created is NOT true.
 * Maps local chunk IDs to sync_ids using storage lookups.
 *
 * Returns null for auto-created edges or if either chunk cannot be found.
 */
export async function exportEdge(
  edge: GraphEdge,
  storage: IStorage,
): Promise<SyncEdgeFile | null> {
  // Skip auto-created edges — they are rebuilt locally after import
  if (edge.auto_created === true || (edge.auto_created as unknown) === 'true') {
    return null;
  }

  // Look up both chunks to get their sync_ids
  const fromChunk = await storage.getChunk(edge.from);
  const toChunk = await storage.getChunk(edge.to);

  if (!fromChunk || !toChunk) {
    log('exportEdge: skipping edge — chunk not found',
      { from: edge.from, to: edge.to, relation: edge.relation });
    return null;
  }

  // Skip edges involving excluded layers
  if (EXCLUDED_LAYERS.includes(fromChunk.layer ?? '') || EXCLUDED_LAYERS.includes(toChunk.layer ?? '')) {
    return null;
  }

  if (!fromChunk.sync_id || !toChunk.sync_id) {
    log('exportEdge: skipping edge — missing sync_id',
      { from: edge.from, to: edge.to });
    return null;
  }

  return {
    from_sync_id: fromChunk.sync_id,
    to_sync_id: toChunk.sync_id,
    relation: edge.relation,
    created_at: new Date().toISOString(),
  };
}

// ============================================================
// File I/O helpers
// ============================================================

/**
 * Write a single chunk to its JSON file in sync/chunks/{sync_id}.json.
 * Uses sorted keys for stable git diffs.
 */
export async function exportChunkToFile(chunk: StoredChunk, syncDir: string): Promise<void> {
  const chunksDir = join(syncDir, 'chunks');
  mkdirSync(chunksDir, { recursive: true });

  const syncChunk = exportChunk(chunk);
  const filePath = join(chunksDir, `${syncChunk.sync_id}.json`);
  writeFileSync(filePath, stableStringify(syncChunk) + '\n', 'utf-8');
}

/**
 * Remove the sync file for a chunk.
 */
export async function removeChunkFile(syncId: string, syncDir: string): Promise<void> {
  const filePath = join(syncDir, 'chunks', `${syncId}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

// ============================================================
// Full export
// ============================================================

/**
 * Export all syncable chunks and manual edges to the sync directory.
 *
 * 1. Lists all chunks (excluding operational/entity-index layers)
 * 2. Writes sync/chunks/{sync_id}.json for each
 * 3. Gets all edges, filters to non-auto-created, writes sync/edges/{hash}.json
 * 4. Writes manifest.json
 * 5. Returns counts
 */
export async function exportAll(
  storage: IStorage,
  syncDir: string,
): Promise<{ chunks: number; edges: number }> {
  const chunksDir = join(syncDir, 'chunks');
  const edgesDir = join(syncDir, 'edges');
  mkdirSync(chunksDir, { recursive: true });
  mkdirSync(edgesDir, { recursive: true });

  // 1. Export all syncable chunks
  const allChunks = await storage.listChunks({}, 10000);
  let chunkCount = 0;

  for (const chunk of allChunks) {
    // Skip operational and entity-index layers
    if (EXCLUDED_LAYERS.includes(chunk.layer ?? '')) continue;
    // Skip chunks without a sync_id (should not happen after migration)
    if (!chunk.sync_id) continue;

    const syncChunk = exportChunk(chunk);
    const filePath = join(chunksDir, `${syncChunk.sync_id}.json`);
    writeFileSync(filePath, stableStringify(syncChunk) + '\n', 'utf-8');
    chunkCount++;
  }

  // 2. Export manual edges
  const allEdges = await storage.getAllEdges();
  let edgeCount = 0;

  for (const edge of allEdges) {
    const syncEdge = await exportEdge(edge, storage);
    if (!syncEdge) continue;

    const hash = computeEdgeHash(syncEdge.from_sync_id, syncEdge.relation, syncEdge.to_sync_id);
    const filePath = join(edgesDir, `${hash}.json`);
    writeFileSync(filePath, stableStringify(syncEdge) + '\n', 'utf-8');
    edgeCount++;
  }

  // 3. Write manifest
  const manifest: SyncManifest = {
    format_version: 1,
    last_export_at: new Date().toISOString(),
    last_import_at: '',
    chunk_count: chunkCount,
    edge_count: edgeCount,
  };
  writeFileSync(
    join(syncDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );

  log(`exportAll: exported ${chunkCount} chunks, ${edgeCount} edges to ${syncDir}`);
  return { chunks: chunkCount, edges: edgeCount };
}
