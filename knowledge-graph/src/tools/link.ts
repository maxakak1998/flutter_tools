import { KuzuStorage } from '../storage/kuzu.js';
import { LinkResult, RELATION_TABLE_MAP, log } from '../types.js';

export async function handleLink(
  storage: KuzuStorage,
  sourceId: string,
  targetId: string,
  relation: string
): Promise<LinkResult> {
  const relTable = RELATION_TABLE_MAP[relation];
  if (!relTable) {
    throw new Error(
      `Invalid relation type: ${relation}. Must be one of: ${Object.keys(RELATION_TABLE_MAP).join(', ')}`
    );
  }

  // Verify both chunks exist
  const source = await storage.getChunk(sourceId);
  if (!source) throw new Error(`Source chunk not found: ${sourceId}`);

  const target = await storage.getChunk(targetId);
  if (!target) throw new Error(`Target chunk not found: ${targetId}`);

  await storage.createRelation(sourceId, targetId, relTable, 'Chunk', 'Chunk');

  log('Linked', sourceId, '-[', relation, ']->', targetId);
  return {
    created: true,
    source_id: sourceId,
    target_id: targetId,
    relation,
  };
}
