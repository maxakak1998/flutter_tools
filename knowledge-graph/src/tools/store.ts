import { randomUUID } from 'crypto';
import { KuzuStorage } from '../storage/kuzu.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkMetadata, ChunkLayer, ChunkCategory, StoreResult, StepEmitter, log } from '../types.js';
import { validateCodeRefs } from '../engine/validator.js';

/** Convert a string to kebab-case: lowercase, replace spaces/underscores with hyphens, collapse multiple hyphens. */
function toKebabCase(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Auto-infer layer from category and code_refs when not explicitly provided. */
function inferLayer(category: ChunkCategory, hasCodeRefs: boolean): ChunkLayer {
  switch (category) {
    case 'concept':
    case 'rule':
    case 'workflow':
      return 'business-domain';
    case 'pattern':
    case 'example':
    case 'learning':
      return 'code-knowledge';
    case 'reference':
      return hasCodeRefs ? 'code-knowledge' : 'business-domain';
  }
}

export async function handleStore(
  storage: KuzuStorage,
  embedder: Embedder,
  linker: Linker,
  content: string,
  metadata: ChunkMetadata,
  onStep?: StepEmitter,
  dedupThreshold = 0.95,
): Promise<StoreResult> {
  // Generate embedding first (needed for both dedup check and storage)
  onStep?.('embedding', 'Generating embedding via Ollama');
  const embedding = await embedder.embed(content);
  onStep?.('embedding_done', 'Embedding generated', { dimensions: embedding.length });

  // Semantic deduplication check
  onStep?.('dedup_check', 'Checking for semantic duplicates');
  const [topHit] = await storage.vectorSearchUnfiltered(embedding, 1);
  if (topHit) {
    const similarity = 1 - topHit.distance;
    if (similarity >= dedupThreshold) {
      onStep?.('dedup_hit', 'Semantic duplicate detected', {
        existing_id: topHit.chunk.id,
        similarity,
        existing_summary: topHit.chunk.summary,
      });
      log('Semantic duplicate detected (similarity:', similarity.toFixed(4), '), returning existing chunk:', topHit.chunk.id);
      return {
        id: topHit.chunk.id,
        auto_links: [],
        warnings: [],
        duplicate_of: topHit.chunk.id,
        similarity,
        existing_summary: topHit.chunk.summary,
      };
    }
  }

  // Normalize metadata before storage
  const normalizedKeywords = [...new Set(metadata.keywords.map(k => k.toLowerCase()))];
  const normalizedTags = [...new Set((metadata.tags ?? []).map(t => toKebabCase(t)))];
  const normalizedEntities = [...new Set(metadata.entities ?? [])].filter(e => e.length >= 2);
  const normalizedSource = metadata.source?.trim() ?? null;

  // Resolve layer: explicit value wins, otherwise auto-infer from category
  const hasCodeRefs = (metadata.code_refs ?? []).length > 0;
  const layer = metadata.layer ?? inferLayer(metadata.category, hasCodeRefs);

  // Create chunk
  const id = randomUUID();
  await storage.createChunk({
    id,
    content,
    summary: metadata.summary,
    embedding,
    source: normalizedSource,
    category: metadata.category,
    domain: metadata.domain,
    importance: metadata.importance,
    layer,
    keywords: normalizedKeywords,
    entities: normalizedEntities,
    tags: normalizedTags,
    version: 1,
  });

  onStep?.('stored', 'Chunk created in KuzuDB', { id });

  // Validate code_refs
  const warnings = metadata.code_refs ? validateCodeRefs(metadata.code_refs) : [];

  // Handle code_refs if provided
  if (metadata.code_refs && metadata.code_refs.length > 0) {
    for (const ref of metadata.code_refs) {
      try {
        const codeId = `code-${randomUUID().slice(0, 8)}`;
        const codeEmbedding = await embedder.embed(
          `${ref.name} ${ref.entity_type} ${ref.file_path}`
        );
        await storage.createCodeEntity({
          id: codeId,
          name: ref.name.trim(),
          entity_type: ref.entity_type,
          file_path: ref.file_path.trim(),
          line_start: ref.line_start ?? null,
          line_end: null,
          signature: ref.signature?.trim() ?? null,
          layer: ref.layer ?? null,
          feature: ref.feature ?? null,
          embedding: codeEmbedding,
        });

        // Map relation to table name
        const relMap: Record<string, string> = {
          implemented_by: 'IMPLEMENTED_BY',
          tested_by: 'TESTED_BY',
          demonstrated_in: 'DEMONSTRATED_IN',
        };
        const relTable = relMap[ref.relation];
        if (relTable) {
          await storage.createRelation(
            id,
            codeId,
            relTable,
            'Chunk',
            'CodeEntity',
            ref.description ? { description: ref.description } : undefined
          );
        }
      } catch (e) {
        log('Failed to create code ref:', ref.name, e);
      }
    }
  }

  // Auto-link
  onStep?.('auto_link', 'Running auto-linking');
  const autoLinks = await linker.autoLink(
    id,
    embedding,
    metadata.suggested_relations
  );
  onStep?.('auto_link_done', `Found ${autoLinks.length} auto-links`, { links: autoLinks });

  log('Stored chunk:', id, 'with', autoLinks.length, 'auto-links');
  return { id, auto_links: autoLinks, warnings };
}
