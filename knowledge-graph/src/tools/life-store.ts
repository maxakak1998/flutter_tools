import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkMetadata, LifeStoreResult, StepEmitter, log } from '../types.js';

// === Normalization (reused from store.ts pattern) ===

/** Convert a string to kebab-case: lowercase, replace spaces/underscores with hyphens, collapse multiple hyphens. */
function toKebabCase(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Life-type tag prefixes that satisfy the "at least 1 life: tag" requirement
const LIFE_TAG_PREFIX = 'life:';

const VALID_LIFE_TAGS = [
  'life:gotcha',
  'life:pattern',
  'life:anti-pattern',
  'life:workaround',
  'life:tool-limitation',
];

/**
 * Operational learning store handler.
 *
 * Stores coding gotchas, patterns, workarounds, and tool limitations in the
 * same database as domain knowledge but in a separate `layer='operational'`.
 *
 * Key differences from domain store (handleStore):
 *  - Forces layer='operational', confidence=initialScore/10, lifecycle='active'
 *  - Dedup uses k=50 with post-filter to layer='operational' only
 *  - Requires at least 1 tag starting with `life:`
 *  - No interview protocol, no source requirement
 *  - No proactive surfacing of domain knowledge
 */
export async function handleLifeStore(
  storage: IStorage,
  embedder: Embedder,
  linker: Linker,
  config: { operational: { initialScore: number }; dedup: { similarityThreshold: number } },
  content: string,
  metadata: ChunkMetadata,
  onStep?: StepEmitter,
): Promise<LifeStoreResult> {
  const warnings: string[] = [];

  // --- Normalize metadata (same patterns as store.ts) ---
  const normalizedKeywords = [...new Set(metadata.keywords.map(k => k.toLowerCase()))];
  const normalizedTags = [...new Set((metadata.tags ?? []).map(t => toKebabCase(t)))];
  const rawEntities = (metadata.entities ?? []).map(e => typeof e === 'string' ? e : e.name);
  const normalizedEntities = [...new Set(rawEntities)].filter(e => e.length >= 2);
  const normalizedDomain = toKebabCase(metadata.domain);
  const normalizedSource = metadata.source?.trim() ?? null;

  // --- Validate: at least 1 tag starting with `life:` ---
  const lifeTags = normalizedTags.filter(t => t.startsWith(LIFE_TAG_PREFIX));
  if (lifeTags.length === 0) {
    throw new Error(
      `Operational learnings require at least 1 tag starting with "life:" (valid: ${VALID_LIFE_TAGS.join(', ')}). Got tags: [${normalizedTags.join(', ')}]`
    );
  }

  // Warn on unrecognized life: tags (not an error, just advisory)
  for (const tag of lifeTags) {
    if (!VALID_LIFE_TAGS.includes(tag)) {
      warnings.push(`Unrecognized life tag "${tag}". Known tags: ${VALID_LIFE_TAGS.join(', ')}`);
    }
  }

  // --- Embedding ---
  onStep?.('embedding', 'Generating embedding via Ollama');
  const embedding = await embedder.embed(content);
  onStep?.('embedding_done', 'Embedding generated', { dimensions: embedding.length });

  // --- Dedup: k=50 with post-filter to layer='operational' ---
  onStep?.('dedup_check', 'Checking for operational duplicates (k=50, layer=operational)');
  const dedupThreshold = config.dedup.similarityThreshold;
  const candidates = await storage.vectorSearchUnfiltered(embedding, 50);

  for (const hit of candidates) {
    // Post-filter: only compare against operational layer chunks
    if (hit.chunk.layer !== 'operational') continue;

    const similarity = 1 - hit.distance;
    if (similarity >= dedupThreshold) {
      onStep?.('dedup_hit', 'Operational duplicate detected', {
        existing_id: hit.chunk.id,
        similarity,
        existing_summary: hit.chunk.summary,
      });
      log('Operational duplicate detected (similarity:', similarity.toFixed(4), '), returning existing chunk:', hit.chunk.id);
      return {
        id: hit.chunk.id,
        score: hit.chunk.confidence,
        lifecycle: hit.chunk.lifecycle,
        auto_links: [],
        warnings: [],
        duplicate_of: hit.chunk.id,
        similarity,
        existing_summary: hit.chunk.summary,
        existing_content: hit.chunk.content,
      };
    }
  }

  // --- Forced operational defaults ---
  const layer = 'operational';
  const confidence = config.operational.initialScore / 10; // e.g. 5 -> 0.5
  const lifecycle = 'active';

  // --- Create chunk ---
  const id = randomUUID();
  const sync_id = randomUUID();
  await storage.createChunk({
    id,
    sync_id,
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

  onStep?.('stored', 'Operational learning stored', { id, layer, confidence, lifecycle });

  // --- Auto-link (calls linker normally; sourceLayer filtering handled separately) ---
  onStep?.('auto_link', 'Running auto-linking');
  const autoLinks = await linker.autoLink(
    id,
    embedding,
    metadata.suggested_relations,
    'operational', // sourceLayer: only link within operational layer
    normalizedDomain,
  );
  onStep?.('auto_link_done', `Found ${autoLinks.length} auto-links`, { links: autoLinks });

  log('Stored operational learning:', id, 'with', autoLinks.length, 'auto-links');

  return {
    id,
    score: confidence,
    lifecycle,
    auto_links: autoLinks,
    warnings,
  };
}
