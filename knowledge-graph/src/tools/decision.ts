import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkMetadata, Importance, StoreResult, StepEmitter, log } from '../types.js';
import { EntityAliasRegistry } from '../entity-registry.js';
import { handleStore } from './store.js';

/**
 * Decision record handler.
 *
 * Records an architectural/design decision with rationale and what it supersedes.
 * Decisions are DURABLE knowledge: they live in the Chunk table (with embedding,
 * lifecycle, and SUPERSEDES lineage) so they are semantically queryable — NOT in
 * volatile SessionState.
 *
 * Key difference from handleStore: the 0.88 dedup check is bypassed (skipDedup=true)
 * so near-identical iterative decisions ("lever A failed" vs "lever A retry") each
 * persist as their own chunk instead of being merged into an existing one.
 *
 * When supersedes_id is provided, a SUPERSEDES edge is created from the new decision
 * chunk to the decision it replaces, forming a queryable decision lineage.
 */
export async function handleDecisionRecord(
  storage: IStorage,
  embedder: Embedder,
  linker: Linker,
  content: string,
  summary: string,
  domain: string,
  keywords: string[],
  importance: Importance | undefined,
  supersedes_id: string | undefined,
  rationale: string | undefined,
  onStep?: StepEmitter,
  dedupThreshold = 0.88,
  hypothesisInitialConfidence = 0.3,
  domainAliases?: Record<string, string>,
  canonicalDomains?: string[],
  entityRegistry?: EntityAliasRegistry,
): Promise<StoreResult> {
  const metadata: ChunkMetadata = {
    summary,
    keywords,
    domain,
    category: 'decision',
    importance: importance ?? 'high',
  };

  // Reuse the shared store path with forced dedup bypass so iterative decisions persist.
  const result = await handleStore(
    storage,
    embedder,
    linker,
    content,
    metadata,
    onStep,
    dedupThreshold,
    hypothesisInitialConfidence,
    domainAliases,
    canonicalDomains,
    entityRegistry,
    true, // skipDedup
  );

  // Link the new decision to the one it supersedes (queryable lineage).
  if (supersedes_id) {
    try {
      const reason = rationale ?? `Decision ${result.id} supersedes ${supersedes_id}`;
      await storage.createRelation(result.id, supersedes_id, 'SUPERSEDES', { reason });
      result.superseded_id = supersedes_id;
    } catch (e) {
      log('Decision supersede link failed:', supersedes_id, e);
      result.warnings.push(`Failed to create SUPERSEDES edge to ${supersedes_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log('Recorded decision:', result.id, supersedes_id ? `(supersedes ${supersedes_id})` : '');
  return result;
}
