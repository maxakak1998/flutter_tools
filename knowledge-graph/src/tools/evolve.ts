import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkCategory, ChunkLayer, ChunkMetadata, EvolveResult, EntityObject, RELATION_TABLE_MAP, StepEmitter, log } from '../types.js';
import { EntityAliasRegistry } from '../entity-registry.js';
import { toKebabCase } from './store.js';

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
      const canonical = registry?.resolve(entry) ?? entry;
      names.push(canonical);
    } else {
      const canonical = entry.name;
      names.push(canonical);
      if (entry.alias && registry) {
        const added = registry.addAlias(entry.alias, canonical);
        if (added) newAliasesRegistered = true;
      }
    }
  }

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

  const existing = await storage.listChunks({ layer: 'entity-index', domain }, 1);
  if (existing.length > 0) {
    return { id: existing[0].id, created: false };
  }

  const aliases: string[] = [];
  if (registry) {
    for (const [alias, canonical] of Object.entries(registry.allAliases())) {
      if (canonical === entityName) aliases.push(alias);
    }
  }

  const content = `Entity: ${entityName}`;
  const embedding = await embedder.embed(content);
  const id = randomUUID();
  const sync_id = randomUUID();

  await storage.createChunk({
    id,
    sync_id,
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

export async function handleEvolve(
  storage: IStorage,
  embedder: Embedder,
  linker: Linker,
  id: string,
  newContent: string,
  newMetadata: Partial<ChunkMetadata> | undefined,
  reason: string,
  onStep?: StepEmitter,
  domainAliases?: Record<string, string>,
  entityRegistry?: EntityAliasRegistry,
): Promise<EvolveResult> {
  // Fetch existing chunk
  const existing = await storage.getChunk(id);
  if (!existing) throw new Error(`Chunk not found: ${id}`);
  onStep?.('fetch', 'Fetched existing chunk', { version: existing.version, summary: existing.summary });

  // Archive old version: create a snapshot chunk with SUPERSEDES edge
  onStep?.('archive', 'Archiving old version');
  const archiveId = `archive-${randomUUID().slice(0, 8)}`;
  const archiveSyncId = randomUUID();
  await storage.createChunk({
    id: archiveId,
    sync_id: archiveSyncId,
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
    ? toKebabCase(domainAliases?.[newMetadata.domain] ?? newMetadata.domain)
    : existing.domain;
  const resolvedKeywords = newMetadata?.keywords !== undefined
    ? [...new Set(newMetadata.keywords.map(k => k.toLowerCase()))]
    : existing.keywords;
  const resolvedTags = newMetadata?.tags !== undefined
    ? [...new Set(newMetadata.tags.map(t => toKebabCase(t)))]
    : existing.tags;

  // Resolve entities via alias registry (supports both string and EntityObject)
  let resolvedEntities: string[];
  let newAliasesRegistered = false;
  if (newMetadata?.entities !== undefined) {
    const result = resolveEntities(newMetadata.entities, entityRegistry);
    resolvedEntities = result.canonicalNames;
    newAliasesRegistered = result.newAliasesRegistered;
  } else {
    resolvedEntities = existing.entities;
  }

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
  await linker.relinkChunk(id, newEmbedding, newMetadata?.suggested_relations, undefined, resolvedDomain);
  onStep?.('re_link_done', 'Re-linking complete');

  // Entity-index chunk creation and linking for new entities
  if (newMetadata?.entities !== undefined && resolvedEntities.length > 0) {
    for (const entityName of resolvedEntities) {
      try {
        const { id: entityChunkId } = await ensureEntityChunk(
          storage, embedder, entityName, entityRegistry,
        );
        // Create IS_PART_OF edge: knowledge chunk → entity chunk
        // (existing edges are preserved — createRelation is idempotent or additive)
        await storage.createRelation(id, entityChunkId, 'IS_PART_OF');
      } catch (e) {
        log('Entity chunk creation failed during evolve for', entityName, ':', e);
      }
    }

    // Create inter-entity relations from metadata.relations
    if (newMetadata?.relations && newMetadata.relations.length > 0) {
      for (const rel of newMetadata.relations) {
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
          log('Inter-entity relation creation failed during evolve:', rel, e);
        }
      }
    }
  }

  // Persist alias registry if new aliases were registered
  if (newAliasesRegistered && entityRegistry) {
    entityRegistry.save();
  }

  log('Evolved chunk:', id, 'to v' + newVersion, '| reason:', reason);
  return {
    id,
    version: newVersion,
    reason,
    superseded_id: archiveId,
    note: 'Content evolved. If the meaning changed significantly, consider re-validating this chunk.',
  };
}
