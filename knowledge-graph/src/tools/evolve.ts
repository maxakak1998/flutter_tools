import { randomUUID } from 'crypto';
import { KuzuStorage } from '../storage/kuzu.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkMetadata, EvolveResult, StepEmitter, log } from '../types.js';

export async function handleEvolve(
  storage: KuzuStorage,
  embedder: Embedder,
  linker: Linker,
  id: string,
  newContent: string,
  newMetadata: Partial<ChunkMetadata> | undefined,
  reason: string,
  onStep?: StepEmitter
): Promise<EvolveResult> {
  // Fetch existing chunk
  const existing = await storage.getChunk(id);
  if (!existing) throw new Error(`Chunk not found: ${id}`);
  onStep?.('fetch', 'Fetched existing chunk', { version: existing.version, summary: existing.summary });

  // Archive old version: create a snapshot chunk with SUPERSEDES edge
  onStep?.('archive', 'Archiving old version');
  const archiveId = `archive-${randomUUID().slice(0, 8)}`;
  await storage.createChunk({
    id: archiveId,
    content: existing.content,
    summary: `[ARCHIVED v${existing.version}] ${existing.summary}`,
    embedding: existing.embedding,
    source: existing.source,
    category: existing.category,
    domain: existing.domain,
    importance: 'low',
    layer: existing.layer,
    keywords: existing.keywords,
    entities: existing.entities,
    tags: [...existing.tags, 'archived'],
    version: existing.version,
  });

  // Create SUPERSEDES edge: new → old
  await storage.createRelation(
    id,
    archiveId,
    'SUPERSEDES',
    'Chunk',
    'Chunk',
    { reason }
  );
  onStep?.('archive_done', `Archived as ${archiveId}`, { archive_id: archiveId });

  // Re-embed new content
  onStep?.('re_embed', 'Re-embedding new content');
  const newEmbedding = await embedder.embed(newContent);
  const newVersion = existing.version + 1;
  onStep?.('re_embed_done', 'New embedding generated');

  // Update the chunk
  onStep?.('update', 'Updating chunk in KuzuDB');
  await storage.updateChunk(id, {
    content: newContent,
    summary: newMetadata?.summary ?? existing.summary,
    embedding: newEmbedding,
    category: newMetadata?.category ?? existing.category,
    domain: newMetadata?.domain ?? existing.domain,
    importance: newMetadata?.importance ?? existing.importance,
    layer: newMetadata?.layer ?? existing.layer,
    keywords: newMetadata?.keywords ?? existing.keywords,
    entities: newMetadata?.entities ?? existing.entities,
    tags: newMetadata?.tags ?? existing.tags,
    version: newVersion,
  });
  onStep?.('update_done', `Updated to v${newVersion}`);

  // Re-run auto-linking with new embedding
  onStep?.('re_link', 'Re-running auto-linking');
  await linker.relinkChunk(id, newEmbedding, newMetadata?.suggested_relations);
  onStep?.('re_link_done', 'Re-linking complete');

  log('Evolved chunk:', id, 'to v' + newVersion, '| reason:', reason);
  return {
    id,
    version: newVersion,
    reason,
    superseded_id: archiveId,
  };
}
