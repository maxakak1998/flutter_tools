import { join } from 'path';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { IStorage } from '../storage/interface.js';
import { log } from '../types.js';
import { exportChunkToFile, removeChunkFile, exportEdge } from './export.js';
import { SyncManifest, computeEdgeHash, stableStringify } from './format.js';

// ============================================================
// Auto-exporter interface
// ============================================================

export interface AutoExporter {
  /** Queue a chunk for export by local DB id. */
  queueChunkExport(chunkId: string): void;
  /** Queue removal of a sync file by sync_id. */
  queueChunkRemoval(syncId: string): void;
  /** Queue re-export of all manual edges. */
  queueEdgeRefresh(): void;
  /** Force flush all pending exports immediately. */
  flush(): Promise<void>;
  /** Cancel pending timers and clear state. */
  destroy(): void;
}

// ============================================================
// Layers excluded from sync (same as export.ts)
// ============================================================

const EXCLUDED_LAYERS = ['operational', 'entity-index'];

// ============================================================
// Factory
// ============================================================

const DEBOUNCE_MS = 250;

export function createAutoExporter(
  storage: IStorage,
  syncDir: string,
): AutoExporter {
  const pendingExports = new Set<string>();       // local chunk IDs to export
  const pendingRemovals = new Set<string>();       // sync_ids to remove
  let edgeRefreshNeeded = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function resetTimer(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function scheduleFlush(): void {
    if (destroyed) return;
    resetTimer();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runFlush().catch(e => {
        log('AutoExporter: flush error:', e);
      });
    }, DEBOUNCE_MS);
  }

  async function runFlush(): Promise<void> {
    // Snapshot and clear pending sets atomically
    const chunkIds = [...pendingExports];
    const removalSyncIds = [...pendingRemovals];
    const doEdgeRefresh = edgeRefreshNeeded;
    pendingExports.clear();
    pendingRemovals.clear();
    edgeRefreshNeeded = false;

    if (chunkIds.length === 0 && removalSyncIds.length === 0 && !doEdgeRefresh) {
      return; // Nothing to do
    }

    const chunksDir = join(syncDir, 'chunks');
    const edgesDir = join(syncDir, 'edges');
    mkdirSync(chunksDir, { recursive: true });
    mkdirSync(edgesDir, { recursive: true });

    let exportedCount = 0;
    let removedCount = 0;

    // 1. Export pending chunks
    for (const chunkId of chunkIds) {
      try {
        const chunk = await storage.getChunk(chunkId);
        if (!chunk) {
          log(`AutoExporter: chunk ${chunkId} not found, skipping export`);
          continue;
        }
        // Skip excluded layers
        if (EXCLUDED_LAYERS.includes(chunk.layer ?? '')) continue;
        // Skip chunks without sync_id
        if (!chunk.sync_id) {
          log(`AutoExporter: chunk ${chunkId} has no sync_id, skipping export`);
          continue;
        }
        await exportChunkToFile(chunk, syncDir);
        exportedCount++;
      } catch (e) {
        log(`AutoExporter: failed to export chunk ${chunkId}:`, e);
      }
    }

    // 2. Remove pending chunk files
    for (const syncId of removalSyncIds) {
      try {
        await removeChunkFile(syncId, syncDir);
        removedCount++;
      } catch (e) {
        log(`AutoExporter: failed to remove sync file for ${syncId}:`, e);
      }
    }

    // 3. Re-export all manual edges if flagged
    if (doEdgeRefresh) {
      try {
        // Clear existing edge files
        if (existsSync(edgesDir)) {
          const existingFiles = readdirSync(edgesDir).filter(f => f.endsWith('.json'));
          for (const f of existingFiles) {
            try { unlinkSync(join(edgesDir, f)); } catch { /* ignore */ }
          }
        }

        // Export all manual edges
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
        log(`AutoExporter: refreshed ${edgeCount} edge files`);
      } catch (e) {
        log('AutoExporter: edge refresh failed:', e);
      }
    }

    // 4. Update manifest
    try {
      await updateManifest(syncDir);
    } catch (e) {
      log('AutoExporter: manifest update failed:', e);
    }

    if (exportedCount > 0 || removedCount > 0) {
      log(`AutoExporter: exported ${exportedCount} chunks, removed ${removedCount} files`);
    }
  }

  return {
    queueChunkExport(chunkId: string): void {
      if (destroyed) return;
      pendingExports.add(chunkId);
      scheduleFlush();
    },

    queueChunkRemoval(syncId: string): void {
      if (destroyed) return;
      pendingRemovals.add(syncId);
      scheduleFlush();
    },

    queueEdgeRefresh(): void {
      if (destroyed) return;
      edgeRefreshNeeded = true;
      scheduleFlush();
    },

    async flush(): Promise<void> {
      resetTimer();
      await runFlush();
    },

    destroy(): void {
      destroyed = true;
      resetTimer();
      pendingExports.clear();
      pendingRemovals.clear();
      edgeRefreshNeeded = false;
    },
  };
}

// ============================================================
// Manifest update helper
// ============================================================

async function updateManifest(syncDir: string): Promise<void> {
  const chunksDir = join(syncDir, 'chunks');
  const edgesDir = join(syncDir, 'edges');

  const chunkCount = existsSync(chunksDir)
    ? readdirSync(chunksDir).filter(f => f.endsWith('.json')).length
    : 0;
  const edgeCount = existsSync(edgesDir)
    ? readdirSync(edgesDir).filter(f => f.endsWith('.json')).length
    : 0;

  // Read existing manifest to preserve last_import_at
  const manifestPath = join(syncDir, 'manifest.json');
  let lastImportAt = '';
  let formatVersion = 1;
  if (existsSync(manifestPath)) {
    try {
      const existing: SyncManifest = JSON.parse(
        readFileSync(manifestPath, 'utf-8'),
      );
      lastImportAt = existing.last_import_at || '';
      formatVersion = existing.format_version || 1;
    } catch { /* use defaults */ }
  }

  const manifest: SyncManifest = {
    format_version: formatVersion,
    last_export_at: new Date().toISOString(),
    last_import_at: lastImportAt,
    chunk_count: chunkCount,
    edge_count: edgeCount,
  };

  writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
}
