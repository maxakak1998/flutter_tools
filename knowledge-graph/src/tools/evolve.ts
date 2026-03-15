import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkCategory, ChunkLayer, ChunkMetadata, EvolveResult, StepEmitter, log } from '../types.js';

/** Convert a string to kebab-case: lowercase, replace spaces/underscores with hyphens, collapse multiple hyphens. */
function toKebabCase(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Auto-infer layer from category when not explicitly provided. */
function inferLayer(category: ChunkCategory): ChunkLayer {
  switch (category) {
    case 'fact':
    case 'rule':
      return 'core-knowledge';
    case 'insight':
    case 'question':
      return 'learning';
    case 'workflow':
      return 'procedural';
  }
}

export async function handleEvolve(
  storage: IStorage,
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
    confidence: existing.confidence,
    validation_count: existing.validation_count,
    refutation_count: existing.refutation_count,
    last_validated_at: existing.last_validated_at,
    lifecycle: existing.lifecycle,
    access_count: existing.access_count,
  });

  // Create SUPERSEDES edge: new -> old
  await storage.createRelation(
    id,
    archiveId,
    'SUPERSEDES',
    { reason }
  );
  onStep?.('archive_done', `Archived as ${archiveId}`, { archive_id: archiveId });

  // Re-embed new content
  onStep?.('re_embed', 'Re-embedding new content');
  const newEmbedding = await embedder.embed(newContent);
  const newVersion = existing.version + 1;
  onStep?.('re_embed_done', 'New embedding generated');

  // Resolve category (needed for layer inference)
  const resolvedCategory = (newMetadata?.category ?? existing.category) as ChunkCategory;

  // Normalize metadata — same rules as store.ts
  const resolvedDomain = newMetadata?.domain !== undefined
    ? toKebabCase(newMetadata.domain)
    : existing.domain;
  const resolvedKeywords = newMetadata?.keywords !== undefined
    ? [...new Set(newMetadata.keywords.map(k => k.toLowerCase()))]
    : existing.keywords;
  const resolvedTags = newMetadata?.tags !== undefined
    ? [...new Set(newMetadata.tags.map(t => toKebabCase(t)))]
    : existing.tags;
  const resolvedEntities = newMetadata?.entities !== undefined
    ? [...new Set(newMetadata.entities)].filter(e => e.length >= 2)
    : existing.entities;

  // Re-infer layer when category changes and no explicit layer provided
  const categoryChanged = newMetadata?.category !== undefined && newMetadata.category !== existing.category;
  const resolvedLayer = newMetadata?.layer ?? (categoryChanged ? inferLayer(resolvedCategory) : existing.layer);

  // Update the chunk — only content/metadata fields, NOT learning fields
  onStep?.('update', 'Updating chunk in KuzuDB');
  await storage.updateChunk(id, {
    content: newContent,
    summary: newMetadata?.summary ?? existing.summary,
    embedding: newEmbedding,
    category: resolvedCategory,
    domain: resolvedDomain,
    importance: newMetadata?.importance ?? existing.importance,
    layer: resolvedLayer,
    keywords: resolvedKeywords,
    entities: resolvedEntities,
    tags: resolvedTags,
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
    note: 'Content evolved. If the meaning changed significantly, consider re-validating this chunk.',
  };
}
