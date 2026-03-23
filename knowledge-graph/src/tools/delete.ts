import { IStorage } from '../storage/interface.js';
import { DeleteResult, log } from '../types.js';

const GUARDED_LIFECYCLES = new Set(['validated', 'promoted', 'canonical']);

export async function handleDelete(
  storage: IStorage,
  id: string,
  reason?: string
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

  // Capture snapshot before deletion
  const snapshot = {
    domain: chunk.domain,
    category: chunk.category,
    lifecycle: chunk.lifecycle,
    confidence: chunk.confidence,
    summary: chunk.summary,
  };

  await storage.deleteChunk(id);
  log('Deleted chunk:', id);
  return { deleted: true, id, snapshot, reason };
}
