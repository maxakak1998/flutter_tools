import { createHash } from 'crypto';

// ============================================================
// Sync file format types
// ============================================================

/**
 * Per-chunk JSON file stored in .knowledge-graph/sync/chunks/{sync_id}.json.
 * Contains only durable knowledge — no embeddings, no learning counters.
 */
export interface SyncChunkFile {
  sync_id: string;
  version: number;
  content_hash: string;
  content: string;
  summary: string;
  domain: string;
  category: string;
  importance: string;
  layer: string | null;
  keywords: string[];
  entities: string[];
  tags: string[];
  lifecycle: string;
  source: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Per-edge JSON file stored in .knowledge-graph/sync/edges/{hash}.json.
 * Only manual (non-auto-created) edges are synced.
 */
export interface SyncEdgeFile {
  from_sync_id: string;
  to_sync_id: string;
  relation: string;
  description?: string;
  created_at: string;
}

/**
 * Manifest tracking sync state.
 * Stored at .knowledge-graph/sync/manifest.json.
 */
export interface SyncManifest {
  format_version: number;  // Start at 1
  last_export_at: string;
  last_import_at: string;
  chunk_count: number;
  edge_count: number;
}

/**
 * Result of a delta import operation.
 */
export interface ImportResult {
  new_chunks: number;
  updated_chunks: number;
  deleted_chunks: number;
  blocked_chunks: LifecycleConflict[];
  new_edges: number;
  removed_edges: number;
  relinked_chunks: number;
}

/**
 * A lifecycle conflict that blocks import for one chunk.
 * Requires human resolution via `kg sync resolve`.
 */
export interface LifecycleConflict {
  sync_id: string;
  summary: string;
  local_lifecycle: string;
  remote_lifecycle: string;
  local_updated: string;
  remote_updated: string;
}

// ============================================================
// Utilities
// ============================================================

/**
 * Compute a content hash for delta detection.
 * Returns "sha256:{hex}" format.
 */
export function computeContentHash(content: string): string {
  const hex = createHash('sha256').update(content).digest('hex');
  return `sha256:${hex}`;
}

/**
 * Compute a deterministic filename hash for an edge file.
 * SHA256 of "{fromSyncId}-{relation}-{toSyncId}", first 16 hex chars.
 */
export function computeEdgeHash(fromSyncId: string, relation: string, toSyncId: string): string {
  const input = `${fromSyncId}-${relation}-${toSyncId}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Serialize an object to JSON with sorted keys for stable git diffs.
 * Uses 2-space indentation.
 */
export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort(), 2);
}
