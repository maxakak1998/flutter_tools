import { IStorage } from '../storage/interface.js';
import { DeleteResult, log } from '../types.js';

export async function handleDelete(
  storage: IStorage,
  id: string
): Promise<DeleteResult> {
  const chunk = await storage.getChunk(id);
  if (!chunk) {
    throw new Error(`Chunk not found: ${id}`);
  }

  await storage.deleteChunk(id);
  log('Deleted chunk:', id);
  return { deleted: true, id };
}
