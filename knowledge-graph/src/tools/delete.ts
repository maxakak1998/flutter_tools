import { KuzuStorage } from '../storage/kuzu.js';
import { log } from '../types.js';

export async function handleDelete(
  storage: KuzuStorage,
  id: string
): Promise<{ deleted: boolean; id: string }> {
  const chunk = await storage.getChunk(id);
  if (!chunk) {
    throw new Error(`Chunk not found: ${id}`);
  }

  await storage.deleteChunk(id);
  log('Deleted chunk:', id);
  return { deleted: true, id };
}
