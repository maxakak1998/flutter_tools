import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkMetadata, ChunkLayer, ChunkCategory, StoreResult, StepEmitter, log } from '../types.js';

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

// Target content sizes by category — warns (does not reject) when exceeded
const CONTENT_SIZE_TARGETS: Record<string, number> = {
  fact: 500, rule: 800, insight: 600, question: 400, workflow: 800,
};

export async function handleStore(
  storage: IStorage,
  embedder: Embedder,
  linker: Linker,
  content: string,
  metadata: ChunkMetadata,
  onStep?: StepEmitter,
  dedupThreshold = 0.88,
  hypothesisInitialConfidence = 0.3,
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
        existing_content: topHit.chunk.content,
        action_hint: 'Content overlaps with existing chunk. Use knowledge_evolve to merge new information into the existing chunk, or make your content more distinct.',
      };
    }
  }

  // Proactive surfacing: find related validated/canonical knowledge
  const relatedKnowledge: StoreResult['related_knowledge'] = [];
  try {
    const similar = await storage.vectorSearchUnfiltered(embedding, 5);
    for (const hit of similar) {
      const sim = 1 - hit.distance;
      if (sim >= 0.6 && sim < dedupThreshold &&
          (hit.chunk.lifecycle === 'validated' || hit.chunk.lifecycle === 'canonical' || hit.chunk.lifecycle === 'promoted')) {
        relatedKnowledge.push({
          id: hit.chunk.id,
          summary: hit.chunk.summary,
          confidence: hit.chunk.confidence,
          lifecycle: hit.chunk.lifecycle,
          similarity: Math.round(sim * 1000) / 1000,
          relation_hint: sim >= 0.75 ? 'similar' : 'loosely_related' as const,
        });
      }
    }
  } catch { /* ignore surfacing failures */ }

  // Normalize metadata before storage
  const normalizedKeywords = [...new Set(metadata.keywords.map(k => k.toLowerCase()))];
  const normalizedTags = [...new Set((metadata.tags ?? []).map(t => toKebabCase(t)))];
  const normalizedEntities = [...new Set(metadata.entities ?? [])].filter(e => e.length >= 2);
  const normalizedDomain = toKebabCase(metadata.domain);
  const normalizedSource = metadata.source?.trim() ?? null;

  // Resolve layer: explicit value wins, otherwise auto-infer from category
  const layer = metadata.layer ?? inferLayer(metadata.category);

  // Learning-aware defaults: insights and questions start as hypotheses
  const isHypothesis = metadata.category === 'insight' || metadata.category === 'question';
  const confidence = isHypothesis ? hypothesisInitialConfidence : 0.5;
  const lifecycle = isHypothesis ? 'hypothesis' : 'active';

  // Create chunk
  const id = randomUUID();
  await storage.createChunk({
    id,
    content,
    summary: metadata.summary,
    embedding,
    source: normalizedSource,
    category: metadata.category,
    domain: normalizedDomain,
    importance: metadata.importance,
    layer,
    keywords: normalizedKeywords,
    entities: normalizedEntities,
    tags: normalizedTags,
    version: 1,
    confidence,
    validation_count: 0,
    refutation_count: 0,
    last_validated_at: '',
    lifecycle,
    access_count: 0,
  });

  onStep?.('stored', 'Chunk created in KuzuDB', { id });

  // Warn if content exceeds category-specific size target
  const warnings: string[] = [];
  const sizeTarget = CONTENT_SIZE_TARGETS[metadata.category] || 800;
  if (content.length > sizeTarget) {
    warnings.push(
      `Content is ${content.length} chars (target for ${metadata.category}: ${sizeTarget}). Consider splitting into multiple focused chunks.`
    );
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

  const result: StoreResult = { id, auto_links: autoLinks, warnings };
  if (relatedKnowledge.length > 0) {
    result.related_knowledge = relatedKnowledge;
  }
  return result;
}
