import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkMetadata, ChunkLayer, ChunkCategory, StoreResult, StoreRelation, EntityObject, StepEmitter, RELATION_TABLE_MAP, log } from '../types.js';
import { EntityAliasRegistry } from '../entity-registry.js';

/** Convert a string to kebab-case: lowercase, replace spaces/underscores with hyphens, collapse multiple hyphens. */
export function toKebabCase(s: string): string {
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

/**
 * Resolve entities from mixed (string | EntityObject)[] input.
 * Returns canonical names and registers any new aliases.
 */
function resolveEntities(
  rawEntities: (string | EntityObject)[] | undefined,
  registry?: EntityAliasRegistry,
): { canonicalNames: string[]; newAliasesRegistered: boolean } {
  if (!rawEntities || rawEntities.length === 0) {
    return { canonicalNames: [], newAliasesRegistered: false };
  }

  let newAliasesRegistered = false;
  const names: string[] = [];

  for (const entry of rawEntities) {
    if (typeof entry === 'string') {
      // Plain string — resolve via alias registry
      const canonical = registry?.resolve(entry) ?? entry;
      names.push(canonical);
    } else {
      // EntityObject — register alias if provided, use canonical name
      const canonical = entry.name;
      names.push(canonical);
      if (entry.alias && registry) {
        const added = registry.addAlias(entry.alias, canonical);
        if (added) newAliasesRegistered = true;
        // Also register the canonical name resolving to itself (lowercase key)
      }
    }
  }

  // Deduplicate while preserving order, filter to 2+ chars
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const name of names) {
    if (name.length >= 2 && !seen.has(name)) {
      seen.add(name);
      deduped.push(name);
    }
  }

  return { canonicalNames: deduped, newAliasesRegistered };
}

/**
 * Validate entity-relation consistency.
 * Returns warnings (does not reject) for missing relations on multi-entity chunks.
 */
function validateEntityRelations(
  category: ChunkCategory,
  entities: string[],
  relations: StoreRelation[] | undefined,
): string[] {
  const warnings: string[] = [];
  const relationCount = relations?.length ?? 0;

  if (entities.length >= 2) {
    if (category === 'workflow') {
      if (relationCount < 2) {
        warnings.push(
          `Workflow chunk has ${entities.length} entities but only ${relationCount} relations (recommended: 2-4). ` +
          `Add relations to describe how entities interact in this workflow.`
        );
      }
    } else if (category === 'fact' || category === 'rule') {
      if (relationCount < 1) {
        warnings.push(
          `${category} chunk has ${entities.length} entities but no relations. ` +
          `Add at least 1 relation to describe how these entities interact.`
        );
      }
    }
  }

  // Validate that from_entity and to_entity reference known entities
  if (relations) {
    const entitySet = new Set(entities.map(e => e.toLowerCase()));
    for (const rel of relations) {
      if (!entitySet.has(rel.from_entity.toLowerCase())) {
        warnings.push(`Relation from_entity "${rel.from_entity}" is not in entities list`);
      }
      if (!entitySet.has(rel.to_entity.toLowerCase())) {
        warnings.push(`Relation to_entity "${rel.to_entity}" is not in entities list`);
      }
    }
  }

  return warnings;
}

/**
 * Ensure an entity-index chunk exists for a given entity name.
 * Returns the entity chunk's ID.
 */
async function ensureEntityChunk(
  storage: IStorage,
  embedder: Embedder,
  entityName: string,
  registry?: EntityAliasRegistry,
): Promise<{ id: string; created: boolean }> {
  const domain = toKebabCase(entityName);

  // Search for existing entity-index chunk by domain
  const existing = await storage.listChunks({ layer: 'entity-index', domain }, 1);
  if (existing.length > 0) {
    return { id: existing[0].id, created: false };
  }

  // Gather aliases for this entity (for keywords)
  const aliases: string[] = [];
  if (registry) {
    for (const [alias, canonical] of Object.entries(registry.allAliases())) {
      if (canonical === entityName) aliases.push(alias);
    }
  }

  const content = `Entity: ${entityName}`;
  const embedding = await embedder.embed(content);
  const id = randomUUID();

  await storage.createChunk({
    id,
    content,
    summary: `Entity index: ${entityName}`,
    embedding,
    source: null,
    category: 'fact',
    domain,
    importance: 'medium',
    layer: 'entity-index',
    keywords: [entityName.toLowerCase(), ...aliases.map(a => a.toLowerCase())].filter((v, i, arr) => arr.indexOf(v) === i),
    entities: [entityName],
    tags: ['entity-index'],
    version: 1,
    confidence: 0.5,
    validation_count: 0,
    refutation_count: 0,
    last_validated_at: '',
    lifecycle: 'active',
    access_count: 0,
  });

  return { id, created: true };
}

/**
 * Find the entity-index chunk for a given entity name.
 * Returns null if not found.
 */
async function findEntityChunk(
  storage: IStorage,
  entityName: string,
  registry?: EntityAliasRegistry,
): Promise<string | null> {
  const canonical = registry?.resolve(entityName) ?? entityName;
  const domain = toKebabCase(canonical);
  const existing = await storage.listChunks({ layer: 'entity-index', domain }, 1);
  return existing.length > 0 ? existing[0].id : null;
}

export async function handleStore(
  storage: IStorage,
  embedder: Embedder,
  linker: Linker,
  content: string,
  metadata: ChunkMetadata,
  onStep?: StepEmitter,
  dedupThreshold = 0.88,
  hypothesisInitialConfidence = 0.3,
  domainAliases?: Record<string, string>,
  canonicalDomains?: string[],
  entityRegistry?: EntityAliasRegistry,
): Promise<StoreResult> {
  // Generate embedding first (needed for both dedup check and storage)
  onStep?.('embedding', 'Generating embedding via Ollama');
  const embedding = await embedder.embed(content);
  onStep?.('embedding_done', 'Embedding generated', { dimensions: embedding.length });

  // Semantic deduplication check (k=50 + post-filter to exclude operational/entity-index layer)
  onStep?.('dedup_check', 'Checking for semantic duplicates');
  const dedupCandidates = await storage.vectorSearchUnfiltered(embedding, 50);
  const topHit = dedupCandidates.find(h => h.chunk.layer !== 'operational' && h.chunk.layer !== 'entity-index');
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

  // Proactive surfacing: find related validated/canonical knowledge (exclude operational/entity-index layer)
  const relatedKnowledge: StoreResult['related_knowledge'] = [];
  try {
    const surfaceCandidates = await storage.vectorSearchUnfiltered(embedding, 50);
    for (const hit of surfaceCandidates) {
      if (hit.chunk.layer === 'operational' || hit.chunk.layer === 'entity-index') continue;
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
  const warnings: string[] = [];
  const normalizedKeywords = [...new Set(metadata.keywords.map(k => k.toLowerCase()))];
  const normalizedTags = [...new Set((metadata.tags ?? []).map(t => toKebabCase(t)))];

  // Resolve entities via alias registry (supports both string and EntityObject)
  const { canonicalNames: normalizedEntities, newAliasesRegistered } = resolveEntities(
    metadata.entities,
    entityRegistry,
  );

  // Validate entity-relation consistency
  const entityRelationWarnings = validateEntityRelations(
    metadata.category,
    normalizedEntities,
    metadata.relations,
  );
  warnings.push(...entityRelationWarnings);

  const resolvedDomain = domainAliases?.[metadata.domain] ?? metadata.domain;
  const normalizedDomain = toKebabCase(resolvedDomain);
  if (canonicalDomains?.length && !canonicalDomains.includes(normalizedDomain)) {
    warnings.push(`Domain "${normalizedDomain}" is not in canonical list: ${canonicalDomains.join(', ')}`);
  }
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

  // Entity-index chunk creation and linking
  const entityChunksCreated: string[] = [];
  if (normalizedEntities.length > 0) {
    onStep?.('entity_index', `Processing ${normalizedEntities.length} entities`);

    for (const entityName of normalizedEntities) {
      try {
        const { id: entityChunkId, created } = await ensureEntityChunk(
          storage, embedder, entityName, entityRegistry,
        );
        if (created) entityChunksCreated.push(entityChunkId);

        // Create IS_PART_OF edge: knowledge chunk → entity chunk
        await storage.createRelation(id, entityChunkId, 'IS_PART_OF');
      } catch (e) {
        log('Entity chunk creation failed for', entityName, ':', e);
      }
    }

    // Create inter-entity relations from metadata.relations
    if (metadata.relations && metadata.relations.length > 0) {
      for (const rel of metadata.relations) {
        try {
          const fromEntityId = await findEntityChunk(storage, rel.from_entity, entityRegistry);
          const toEntityId = await findEntityChunk(storage, rel.to_entity, entityRegistry);
          if (fromEntityId && toEntityId) {
            const relTable = RELATION_TABLE_MAP[rel.relation];
            if (relTable) {
              await storage.createRelation(fromEntityId, toEntityId, relTable, { description: `${rel.from_entity} ${rel.relation} ${rel.to_entity}` });
            }
          }
        } catch (e) {
          log('Inter-entity relation creation failed:', rel, e);
        }
      }
    }

    onStep?.('entity_index_done', `Created ${entityChunksCreated.length} entity chunks, linked ${normalizedEntities.length} entities`);
  }

  // Persist alias registry if new aliases were registered
  if (newAliasesRegistered && entityRegistry) {
    entityRegistry.save();
  }

  log('Stored chunk:', id, 'with', autoLinks.length, 'auto-links');

  const result: StoreResult = { id, auto_links: autoLinks, warnings };
  if (relatedKnowledge.length > 0) {
    result.related_knowledge = relatedKnowledge;
  }
  if (entityChunksCreated.length > 0) {
    result.entity_chunks_created = entityChunksCreated;
  }
  return result;
}
