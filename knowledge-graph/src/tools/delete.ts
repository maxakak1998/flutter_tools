import { IStorage } from '../storage/interface.js';
import { DeleteResult, log } from '../types.js';
import { gcOrphanBytesForRefs } from '../sync/attachment-sync.js';

const GUARDED_LIFECYCLES = new Set(['validated', 'promoted', 'canonical']);

export async function handleDelete(
  storage: IStorage,
  id: string,
  reason?: string,
  syncDir?: string,
): Promise<DeleteResult> {
  const chunk = await storage.getChunk(id);
  if (!chunk) {
    throw new Error(`Chunk not found: ${id}`);
  }

  // Lifecycle guard: validated/promoted/canonical chunks require a reason
  if (GUARDED_LIFECYCLES.has(chunk.lifecycle) && !reason) {
    throw new Error(
      `Cannot delete ${chunk.lifecycle} chunk without a reason. Provide a 'reason' field explaining why this knowledge should be removed.`
    );
  }

  // Capture snapshot before deletion (includes sync_id for sync file cleanup)
  const snapshot = {
    sync_id: chunk.sync_id,
    domain: chunk.domain,
    category: chunk.category,
    lifecycle: chunk.lifecycle,
    confidence: chunk.confidence,
    summary: chunk.summary,
  };

  // [11] cascade: capture the chunk's attachment_refs BEFORE deletion so we can
  // ref-count-GC any bytes that become orphaned once this chunk is gone.
  const cascadeRefs = chunk.attachment_refs ?? [];

  await storage.deleteChunk(id);

  // GC orphaned attachment bytes (row + on-disk bytes + sync JSON) for shas no chunk
  // references anymore. Requires syncDir; skipped when called without it (e.g. tests).
  let gc: { rows_deleted: number; bytes_deleted: number } | undefined;
  if (syncDir && cascadeRefs.length > 0) {
    gc = await gcOrphanBytesForRefs(storage, syncDir, cascadeRefs);
  }

  log('Deleted chunk:', id, gc ? `(GC'd ${gc.rows_deleted} attachment rows, ${gc.bytes_deleted} bytes)` : '');
  return { deleted: true, id, snapshot, reason, attachment_gc: gc };
}
