import { join } from 'path';
import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { IStorage } from '../storage/interface.js';
import { log } from '../types.js';
import { exportChunkToFile, removeChunkFile, exportEdge } from './export.js';
import { computeEdgeHash, stableStringify } from './format.js';
import { exportAttachment, removeAttachmentSyncFile } from './attachment-sync.js';
import { recordSelfWrites, chunkRelPath } from './self-writes.js';

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
  /** Queue export of an attachment's byte-metadata JSON by sha256 (on add). */
  queueAttachmentExport(sha256: string): void;
  /** Queue removal of an attachment's byte-metadata JSON by sha256 (on GC/remove). */
  queueAttachmentRemoval(sha256: string): void;
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
  const pendingAttachExports = new Set<string>();  // attachment sha256s to export
  const pendingAttachRemovals = new Set<string>(); // attachment sha256s to remove
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
    const attachExports = [...pendingAttachExports];
    const attachRemovals = [...pendingAttachRemovals];
    const doEdgeRefresh = edgeRefreshNeeded;
    pendingExports.clear();
    pendingRemovals.clear();
    pendingAttachExports.clear();
    pendingAttachRemovals.clear();
    edgeRefreshNeeded = false;

    if (
      chunkIds.length === 0 &&
      removalSyncIds.length === 0 &&
      attachExports.length === 0 &&
      attachRemovals.length === 0 &&
      !doEdgeRefresh
    ) {
      return; // Nothing to do
    }

    const chunksDir = join(syncDir, 'chunks');
    const edgesDir = join(syncDir, 'edges');
    mkdirSync(chunksDir, { recursive: true });
    mkdirSync(edgesDir, { recursive: true });

    let exportedCount = 0;
    let removedCount = 0;
    // Every sync path this flush wrote or removed → the self-write ledger (manifest),
    // so the import gate does not mistake our own exports for a git pull.
    const touched: string[] = [];

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
        touched.push(chunkRelPath(chunk.sync_id));
        exportedCount++;
      } catch (e) {
        log(`AutoExporter: failed to export chunk ${chunkId}:`, e);
      }
    }

    // 2. Remove pending chunk files
    for (const syncId of removalSyncIds) {
      try {
        await removeChunkFile(syncId, syncDir);
        touched.push(chunkRelPath(syncId));
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
            touched.push(`edges/${f}`);
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
          touched.push(`edges/${hash}.json`);
          edgeCount++;
        }
        log(`AutoExporter: refreshed ${edgeCount} edge files`);
      } catch (e) {
        log('AutoExporter: edge refresh failed:', e);
      }
    }

    // 3b. Export / remove attachment byte-metadata JSON files.
    // On add: publish sync/attachments/<sha>.json so teammates can rebuild the row.
    // On GC/remove: drop the JSON (bytes are content-addressed & GC'd separately).
    for (const sha of attachExports) {
      try {
        const row = await storage.getAttachment(sha);
        if (row) {
          exportAttachment(row, syncDir);
        } else {
          // Row already gone (e.g. immediately GC'd) — ensure no stale JSON lingers.
          removeAttachmentSyncFile(sha, syncDir);
        }
        touched.push(`attachments/${sha}.json`);
      } catch (e) {
        log(`AutoExporter: failed to export attachment ${sha.slice(0, 12)}…:`, e);
      }
    }
    for (const sha of attachRemovals) {
      try {
        removeAttachmentSyncFile(sha, syncDir);
        touched.push(`attachments/${sha}.json`);
      } catch (e) {
        log(`AutoExporter: failed to remove attachment sync file ${sha.slice(0, 12)}…:`, e);
      }
    }

    // 4. Update manifest (+ self-write ledger)
    try {
      await updateManifest(syncDir, touched);
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

    queueAttachmentExport(sha256: string): void {
      if (destroyed) return;
      pendingAttachExports.add(sha256);
      // If a removal was queued for the same sha in this window, the export wins.
      pendingAttachRemovals.delete(sha256);
      scheduleFlush();
    },

    queueAttachmentRemoval(sha256: string): void {
      if (destroyed) return;
      pendingAttachRemovals.add(sha256);
      pendingAttachExports.delete(sha256);
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
      pendingAttachExports.clear();
      pendingAttachRemovals.clear();
      edgeRefreshNeeded = false;
    },
  };
}

// ============================================================
// Manifest update helper
// ============================================================

async function updateManifest(syncDir: string, touched: string[]): Promise<void> {
  const chunksDir = join(syncDir, 'chunks');
  const edgesDir = join(syncDir, 'edges');

  const chunkCount = existsSync(chunksDir)
    ? readdirSync(chunksDir).filter(f => f.endsWith('.json')).length
    : 0;
  const edgeCount = existsSync(edgesDir)
    ? readdirSync(edgesDir).filter(f => f.endsWith('.json')).length
    : 0;

  // Preserves last_import_at/format_version and merges `touched` into the ledger.
  recordSelfWrites(syncDir, touched, {
    last_export_at: new Date().toISOString(),
    chunk_count: chunkCount,
    edge_count: edgeCount,
  });
}
