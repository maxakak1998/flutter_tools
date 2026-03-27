import { join } from 'path';
import { readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { RELATION_TABLE_MAP, log } from '../types.js';
import { KnowledgeConfig } from '../config.js';
import {
  SyncChunkFile,
  SyncEdgeFile,
  SyncManifest,
  ImportResult,
  LifecycleConflict,
  computeContentHash,
  computeEdgeHash,
} from './format.js';
import { detectLifecycleConflict } from './merge.js';

// ============================================================
// File reading helpers
// ============================================================

/**
 * Read and parse a JSON file. Returns null if the file does not exist or is invalid.
 */
function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (e) {
    log('readJsonFile: failed to parse', filePath, e);
    return null;
  }
}

/**
 * Read all JSON files from a directory. Returns parsed objects keyed by filename (without .json).
 */
function readJsonDir<T>(dirPath: string): Map<string, T> {
  const result = new Map<string, T>();
  if (!existsSync(dirPath)) return result;

  const files = readdirSync(dirPath).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const key = file.replace(/\.json$/, '');
    const data = readJsonFile<T>(join(dirPath, file));
    if (data !== null) {
      result.set(key, data);
    }
  }
  return result;
}

// ============================================================
// Delta import
// ============================================================

/**
 * Delta import: read sync files, compare with local DB, apply changes.
 *
 * Logic:
 * 1. Read manifest.json for last import state
 * 2. Scan sync/chunks/ directory — read all JSON files
 * 3. For each sync chunk file:
 *    a. Look up by sync_id in local DB (findChunkBySyncId)
 *    b. If NOT found -> new chunk: embed content, createChunk with sync_id
 *    c. If found AND content_hash differs -> changed chunk: embed new content,
 *       updateChunk (preserve local learning fields)
 *    d. If found AND lifecycle differs -> detect conflict. If conflict -> add to
 *       blocked list, skip this chunk
 *    e. If found AND content_hash same AND lifecycle same -> skip (no change)
 * 4. Find chunks in local DB that are NOT in sync/ (deleted by teammate) -> remove
 * 5. Import edges from sync/edges/ — map sync_ids back to local chunk IDs
 * 6. After ALL chunks imported -> re-run auto-linking for new/changed chunks via linker
 * 7. Update manifest with import timestamp
 * 8. Return ImportResult with counts and blocked conflicts
 */
export async function importAll(
  syncDir: string,
  storage: IStorage,
  embedder: Embedder,
  linker: Linker,
  config: KnowledgeConfig,
): Promise<ImportResult> {
  const result: ImportResult = {
    new_chunks: 0,
    updated_chunks: 0,
    deleted_chunks: 0,
    blocked_chunks: [],
    new_edges: 0,
    removed_edges: 0,
    relinked_chunks: 0,
  };

  const chunksDir = join(syncDir, 'chunks');
  const edgesDir = join(syncDir, 'edges');
  const manifestPath = join(syncDir, 'manifest.json');

  // 1. Read manifest
  const manifest = readJsonFile<SyncManifest>(manifestPath);
  if (!manifest) {
    log('importAll: no manifest found, treating as initial import');
  }

  // 2. Scan sync/chunks/ — read all chunk files
  const remoteSyncChunks = readJsonDir<SyncChunkFile>(chunksDir);
  log(`importAll: found ${remoteSyncChunks.size} sync chunk files`);

  // Track sync_ids we've seen in remote (for deletion detection)
  const remoteSyncIds = new Set<string>();
  // Track local chunk IDs of new/changed chunks (for re-linking)
  const chunksToRelink: Array<{ id: string; embedding: number[]; domain: string; layer: string | null }> = [];

  // 3. Process each remote sync chunk
  for (const [, remoteChunk] of remoteSyncChunks) {
    remoteSyncIds.add(remoteChunk.sync_id);

    // 3a. Look up by sync_id in local DB
    const localChunk = await storage.findChunkBySyncId(remoteChunk.sync_id);

    if (!localChunk) {
      // 3b. New chunk: not in local DB
      await importNewChunk(remoteChunk, storage, embedder, chunksToRelink);
      result.new_chunks++;
      continue;
    }

    // Compute local content hash for comparison
    const localContentHash = computeContentHash(localChunk.content);
    const remoteContentHash = remoteChunk.content_hash;

    // 3d. Check for lifecycle conflict FIRST (before content check)
    const conflict = detectLifecycleConflict(localChunk, remoteChunk);
    if (conflict) {
      // Lifecycle differs — block this chunk
      result.blocked_chunks.push(conflict);
      log(`importAll: lifecycle conflict for ${remoteChunk.sync_id} — local=${localChunk.lifecycle}, remote=${remoteChunk.lifecycle}`);
      continue;
    }

    // 3c. Check if content changed
    if (localContentHash !== remoteContentHash) {
      await importUpdatedChunk(remoteChunk, localChunk.id, storage, embedder, chunksToRelink);
      result.updated_chunks++;
      continue;
    }

    // 3e. Content same, lifecycle same — check metadata changes
    if (hasMetadataChanged(localChunk, remoteChunk)) {
      await importMetadataUpdate(remoteChunk, localChunk.id, storage);
      result.updated_chunks++;
      continue;
    }

    // No change — skip
  }

  // 4. Find local chunks not in remote (deleted by teammate)
  const allLocalChunks = await storage.listChunks({}, 10000);
  for (const localChunk of allLocalChunks) {
    // Skip chunks without sync_id (legacy or operational)
    if (!localChunk.sync_id) continue;
    // Skip operational/entity-index layers (not synced)
    if (localChunk.layer === 'operational' || localChunk.layer === 'entity-index') continue;
    // If this sync_id is NOT in remote, the chunk was deleted by a teammate
    if (!remoteSyncIds.has(localChunk.sync_id)) {
      await storage.deleteChunk(localChunk.id);
      result.deleted_chunks++;
      log(`importAll: deleted local chunk ${localChunk.id} (sync_id: ${localChunk.sync_id}) — removed from sync`);
    }
  }

  // 5. Import edges from sync/edges/
  const remoteEdges = readJsonDir<SyncEdgeFile>(edgesDir);
  const existingEdges = await storage.getAllEdges();

  // Build a set of existing non-auto edge hashes for comparison
  const existingEdgeHashes = new Set<string>();
  for (const edge of existingEdges) {
    if (edge.auto_created === true || (edge.auto_created as unknown) === 'true') continue;

    // Look up sync_ids for the edge endpoints
    const fromChunk = await storage.getChunk(edge.from);
    const toChunk = await storage.getChunk(edge.to);
    if (fromChunk?.sync_id && toChunk?.sync_id) {
      const hash = computeEdgeHash(fromChunk.sync_id, edge.relation, toChunk.sync_id);
      existingEdgeHashes.add(hash);
    }
  }

  for (const [edgeHash, remoteEdge] of remoteEdges) {
    if (existingEdgeHashes.has(edgeHash)) continue;

    // Map sync_ids to local chunk IDs
    const fromChunk = await storage.findChunkBySyncId(remoteEdge.from_sync_id);
    const toChunk = await storage.findChunkBySyncId(remoteEdge.to_sync_id);

    if (!fromChunk || !toChunk) {
      log(`importAll: skipping edge ${edgeHash} — endpoint chunk not found`,
        { from: remoteEdge.from_sync_id, to: remoteEdge.to_sync_id });
      continue;
    }

    // Map relation name to table name
    const relTable = RELATION_TABLE_MAP[remoteEdge.relation] ?? remoteEdge.relation.toUpperCase();
    const props: Record<string, string> | undefined = remoteEdge.description
      ? { description: remoteEdge.description }
      : undefined;

    try {
      await storage.createRelation(fromChunk.id, toChunk.id, relTable, props);
      result.new_edges++;
    } catch (e) {
      log(`importAll: failed to create edge ${edgeHash}:`, e);
    }
  }

  // 6. Re-run auto-linking for new/changed chunks (full corpus available)
  for (const chunkInfo of chunksToRelink) {
    try {
      await linker.relinkChunk(
        chunkInfo.id,
        chunkInfo.embedding,
        undefined, // no suggested relations during import
        chunkInfo.layer ?? undefined,
        chunkInfo.domain,
      );
      result.relinked_chunks++;
    } catch (e) {
      log(`importAll: auto-relink failed for ${chunkInfo.id}:`, e);
    }
  }

  // 7. Update manifest with import timestamp
  const updatedManifest: SyncManifest = {
    format_version: manifest?.format_version ?? 1,
    last_export_at: manifest?.last_export_at ?? '',
    last_import_at: new Date().toISOString(),
    chunk_count: remoteSyncChunks.size,
    edge_count: remoteEdges.size,
  };
  writeFileSync(
    manifestPath,
    JSON.stringify(updatedManifest, null, 2) + '\n',
    'utf-8',
  );

  log(`importAll: ${result.new_chunks} new, ${result.updated_chunks} updated, ` +
    `${result.deleted_chunks} deleted, ${result.blocked_chunks.length} blocked, ` +
    `${result.new_edges} edges, ${result.relinked_chunks} relinked`);

  // 8. Persist lifecycle conflicts to .conflicts.json for hook detection
  persistConflicts(syncDir, result.blocked_chunks);

  return result;
}

// ============================================================
// Conflict persistence for hook detection
// ============================================================

/**
 * Persist lifecycle conflicts to .knowledge-graph/sync/.conflicts.json.
 * This file is read by the sync conflict detection hook (fast filesystem check).
 * If no conflicts, delete the file to signal "all clear".
 */
export function persistConflicts(syncDir: string, conflicts: LifecycleConflict[]): void {
  const conflictsPath = join(syncDir, '.conflicts.json');

  if (conflicts.length === 0) {
    // No conflicts — remove the file if it exists
    if (existsSync(conflictsPath)) {
      try {
        unlinkSync(conflictsPath);
        log('persistConflicts: removed .conflicts.json (no conflicts)');
      } catch (e) {
        log('persistConflicts: failed to remove .conflicts.json:', e);
      }
    }
    return;
  }

  // Write conflicts with detected_at timestamp
  const now = new Date().toISOString();
  const entries = conflicts.map(c => ({
    sync_id: c.sync_id,
    summary: c.summary,
    local_lifecycle: c.local_lifecycle,
    remote_lifecycle: c.remote_lifecycle,
    local_updated: c.local_updated,
    remote_updated: c.remote_updated,
    detected_at: now,
  }));

  try {
    writeFileSync(conflictsPath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
    log(`persistConflicts: wrote ${entries.length} conflict(s) to .conflicts.json`);
  } catch (e) {
    log('persistConflicts: failed to write .conflicts.json:', e);
  }
}

/**
 * Remove a single conflict from .conflicts.json by sync_id.
 * Supports both exact match and prefix match (e.g., first 8 chars).
 * Returns the remaining conflict count. Deletes the file if empty.
 */
export function removeConflict(syncDir: string, syncId: string): number {
  const conflictsPath = join(syncDir, '.conflicts.json');
  if (!existsSync(conflictsPath)) return 0;

  try {
    const raw = readFileSync(conflictsPath, 'utf-8');
    const conflicts = JSON.parse(raw) as Array<{ sync_id: string }>;
    // Support both exact match and prefix match (CLI may pass shortened sync_id)
    const remaining = conflicts.filter(c =>
      c.sync_id !== syncId && !c.sync_id.startsWith(syncId),
    );

    if (remaining.length === 0) {
      unlinkSync(conflictsPath);
      log(`removeConflict: removed .conflicts.json (last conflict resolved)`);
      return 0;
    }

    writeFileSync(conflictsPath, JSON.stringify(remaining, null, 2) + '\n', 'utf-8');
    log(`removeConflict: ${remaining.length} conflict(s) remaining after resolving ${syncId}`);
    return remaining.length;
  } catch (e) {
    log('removeConflict: failed to update .conflicts.json:', e);
    return -1;
  }
}

// ============================================================
// Import helpers
// ============================================================

/**
 * Import a new chunk that does not exist in the local DB.
 * Generates a local UUID id, embeds content, creates chunk with the remote sync_id.
 * Learning fields start at defaults (local-only values).
 */
async function importNewChunk(
  remote: SyncChunkFile,
  storage: IStorage,
  embedder: Embedder,
  chunksToRelink: Array<{ id: string; embedding: number[]; domain: string; layer: string | null }>,
): Promise<void> {
  const embedding = await embedder.embed(remote.content);
  const localId = randomUUID();

  await storage.createChunk({
    id: localId,
    sync_id: remote.sync_id,
    content: remote.content,
    summary: remote.summary,
    embedding,
    source: remote.source,
    category: remote.category,
    domain: remote.domain,
    importance: remote.importance,
    layer: remote.layer,
    keywords: remote.keywords,
    entities: remote.entities,
    tags: remote.tags,
    created_at: remote.created_at,
    updated_at: remote.updated_at,
    version: remote.version,
    // Learning fields: fresh local defaults
    confidence: deriveInitialConfidence(remote.lifecycle),
    validation_count: 0,
    refutation_count: 0,
    last_validated_at: '',
    lifecycle: remote.lifecycle,
    access_count: 0,
  });

  chunksToRelink.push({ id: localId, embedding, domain: remote.domain, layer: remote.layer });
  log(`importAll: created new chunk ${localId} (sync_id: ${remote.sync_id})`);
}

/**
 * Import an updated chunk where content has changed.
 * Re-embeds the new content, updates chunk fields.
 * Preserves local learning fields (confidence, validation_count, etc).
 */
async function importUpdatedChunk(
  remote: SyncChunkFile,
  localId: string,
  storage: IStorage,
  embedder: Embedder,
  chunksToRelink: Array<{ id: string; embedding: number[]; domain: string; layer: string | null }>,
): Promise<void> {
  const embedding = await embedder.embed(remote.content);

  // Update content and metadata — but NOT learning fields
  await storage.updateChunk(localId, {
    content: remote.content,
    summary: remote.summary,
    embedding,
    domain: remote.domain,
    category: remote.category,
    importance: remote.importance,
    layer: remote.layer,
    keywords: remote.keywords,
    entities: remote.entities,
    tags: remote.tags,
    source: remote.source,
    version: remote.version,
    // Do NOT update: confidence, validation_count, refutation_count,
    //   access_count, last_validated_at — these are local-only
  });

  chunksToRelink.push({ id: localId, embedding, domain: remote.domain, layer: remote.layer });
  log(`importAll: updated chunk ${localId} (sync_id: ${remote.sync_id})`);
}

/**
 * Import metadata-only changes (summary, domain, tags, etc changed but content same).
 * Does NOT re-embed or trigger relinking.
 */
async function importMetadataUpdate(
  remote: SyncChunkFile,
  localId: string,
  storage: IStorage,
): Promise<void> {
  await storage.updateChunk(localId, {
    summary: remote.summary,
    domain: remote.domain,
    category: remote.category,
    importance: remote.importance,
    layer: remote.layer,
    keywords: remote.keywords,
    entities: remote.entities,
    tags: remote.tags,
    source: remote.source,
    version: remote.version,
  });

  log(`importAll: metadata update for chunk ${localId} (sync_id: ${remote.sync_id})`);
}

/**
 * Check if metadata (excluding content and lifecycle) differs between local and remote.
 */
function hasMetadataChanged(
  local: { summary: string; domain: string; category: string; importance: string; layer: string | null; keywords: string[]; entities: string[]; tags: string[]; source: string | null; version: number },
  remote: SyncChunkFile,
): boolean {
  if (local.summary !== remote.summary) return true;
  if (local.domain !== remote.domain) return true;
  if (local.category !== remote.category) return true;
  if (local.importance !== remote.importance) return true;
  if (local.layer !== remote.layer) return true;
  if (local.version !== remote.version) return true;
  if ((local.source ?? null) !== (remote.source ?? null)) return true;
  if (JSON.stringify(local.keywords.slice().sort()) !== JSON.stringify(remote.keywords.slice().sort())) return true;
  if (JSON.stringify(local.entities.slice().sort()) !== JSON.stringify(remote.entities.slice().sort())) return true;
  if (JSON.stringify(local.tags.slice().sort()) !== JSON.stringify(remote.tags.slice().sort())) return true;
  return false;
}

/**
 * Derive initial local confidence from lifecycle state.
 * hypothesis=0.3, active=0.5, validated=0.8, promoted=0.9, canonical=0.95, refuted=0.05
 */
function deriveInitialConfidence(lifecycle: string): number {
  switch (lifecycle) {
    case 'hypothesis': return 0.3;
    case 'active': return 0.5;
    case 'validated': return 0.8;
    case 'promoted': return 0.9;
    case 'canonical': return 0.95;
    case 'refuted': return 0.05;
    default: return 0.5;
  }
}
