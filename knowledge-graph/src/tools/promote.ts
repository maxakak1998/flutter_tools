import { IStorage } from '../storage/interface.js';
import { PromoteResult, ChunkCategory, Importance, log } from '../types.js';

export async function handlePromote(
  storage: IStorage,
  id: string,
  reason: string,
  newCategory?: ChunkCategory,
  newImportance?: Importance,
): Promise<PromoteResult> {
  const chunk = await storage.getChunk(id);
  if (!chunk) throw new Error(`Chunk not found: ${id}`);

  // Guards
  if (chunk.confidence < 0.2) {
    throw new Error(`Cannot promote refuted chunk (confidence: ${chunk.confidence}). Confirm it first.`);
  }
  if (chunk.confidence < 0.5) {
    throw new Error(`Cannot promote low-confidence chunk (confidence: ${chunk.confidence}). Needs more validation.`);
  }

  const previousCategory = chunk.category;
  const previousLifecycle = chunk.lifecycle;
  let newLifecycle = chunk.lifecycle;

  // Lifecycle promotion
  if (newLifecycle === 'canonical') {
    throw new Error('Chunk is already canonical — highest lifecycle state.');
  } else if (newLifecycle === 'hypothesis') {
    newLifecycle = 'validated';
  } else if (newLifecycle === 'validated') {
    newLifecycle = 'promoted';
  } else if (newLifecycle === 'promoted' && chunk.confidence >= 0.9) {
    newLifecycle = 'canonical';
  } else if (newLifecycle === 'promoted') {
    throw new Error(`Cannot promote to canonical — confidence ${chunk.confidence} is below 0.9 threshold. Validate the chunk more first.`);
  } else if (newLifecycle === 'active') {
    newLifecycle = 'promoted';
  }

  const updates: Record<string, unknown> = { lifecycle: newLifecycle };
  if (newCategory) updates.category = newCategory;
  if (newImportance) updates.importance = newImportance;

  await storage.updateChunk(id, updates as any);

  log(`Promoted chunk ${id}: ${previousLifecycle} -> ${newLifecycle}, category: ${previousCategory} -> ${newCategory ?? previousCategory}`);

  return {
    id,
    previous_category: previousCategory,
    new_category: (newCategory ?? previousCategory) as string,
    previous_lifecycle: previousLifecycle,
    new_lifecycle: newLifecycle,
    confidence: chunk.confidence,
    reason,
  };
}
