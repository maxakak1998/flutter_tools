import { IStorage } from '../storage/interface.js';
import { Embedder } from './embedder.js';
import {
  SuggestedRelation,
  RELATION_TABLE_MAP,
  AutoLink,
  log,
} from '../types.js';
import { DEFAULT_CONFIG } from '../config.js';

export class Linker {
  constructor(
    private storage: IStorage,
    private embedder: Embedder,
    private similarityThreshold = DEFAULT_CONFIG.search.similarityThreshold,
    private autoLinkTopK = DEFAULT_CONFIG.search.autoLinkTopK,
  ) {}

  /**
   * Auto-link a newly stored chunk:
   * 1. Find similar chunks by vector similarity → create RELATES_TO edges (tagged auto_created)
   * 2. Process Claude's suggested_relations → match by domain/keyword/embedding
   */
  async autoLink(
    chunkId: string,
    embedding: number[],
    suggestedRelations?: SuggestedRelation[]
  ): Promise<AutoLink[]> {
    const links: AutoLink[] = [];

    // 1. Vector similarity auto-linking
    try {
      const similar = await this.storage.vectorSearch(
        embedding,
        this.autoLinkTopK + 1 // +1 to exclude self
      );

      for (const hit of similar) {
        if (hit.chunk.id === chunkId) continue;
        const similarity = 1 - hit.distance;
        if (similarity >= this.similarityThreshold) {
          try {
            await this.storage.createRelation(
              chunkId,
              hit.chunk.id,
              'RELATES_TO',
              { auto_created: 'true' }
            );
            links.push({
              target_id: hit.chunk.id,
              relation: 'relates_to',
              score: Math.round(similarity * 1000) / 1000,
            });
          } catch (e) {
            log('Auto-link failed for', hit.chunk.id, ':', e);
          }
        }
      }
    } catch (e) {
      log('Vector similarity auto-linking failed:', e);
    }

    // 2. Suggested relations from Claude
    if (suggestedRelations && suggestedRelations.length > 0) {
      for (const sr of suggestedRelations) {
        try {
          const match = await this.findBestMatch(sr.concept);
          if (match) {
            const relTable = RELATION_TABLE_MAP[sr.relation] || 'RELATES_TO';
            await this.storage.createRelation(
              chunkId,
              match.id,
              relTable,
            );
            links.push({
              target_id: match.id,
              relation: sr.relation,
              score: match.score,
            });
          }
        } catch (e) {
          log('Suggested relation linking failed for', sr.concept, ':', e);
        }
      }
    }

    return links;
  }

  /**
   * Find the best matching chunk for a concept string.
   * Strategy: domain match > keyword match > embedding match
   */
  private async findBestMatch(
    concept: string
  ): Promise<{ id: string; score: number } | null> {
    // 1. Try domain match
    try {
      const domainChunks = await this.storage.findChunksByDomain(concept);
      if (domainChunks.length > 0) {
        return { id: domainChunks[0].id, score: 0.9 };
      }
    } catch {
      // Domain not found
    }

    // 2. Try keyword match
    try {
      const keywordChunks = await this.storage.findChunksByKeyword(concept);
      if (keywordChunks.length > 0) {
        return { id: keywordChunks[0].id, score: 0.7 };
      }
    } catch {
      // Keyword not found
    }

    // 3. Try embedding match
    try {
      const conceptEmbedding = await this.embedder.embed(concept);
      const hits = await this.storage.vectorSearch(conceptEmbedding, 1);
      if (hits.length > 0) {
        const similarity = 1 - hits[0].distance;
        if (similarity >= 0.5) {
          return {
            id: hits[0].chunk.id,
            score: Math.round(similarity * 1000) / 1000,
          };
        }
      }
    } catch {
      // Embedding match failed
    }

    return null;
  }

  /**
   * Re-run auto-linking for an updated chunk (after evolve).
   * Removes old auto-created RELATES_TO edges, preserves manual links, then creates new auto-links.
   */
  async relinkChunk(
    chunkId: string,
    newEmbedding: number[],
    suggestedRelations?: SuggestedRelation[]
  ): Promise<AutoLink[]> {
    // Delete only auto-created RELATES_TO edges — manual links are preserved
    await this.storage.deleteAutoRelations(chunkId);
    return this.autoLink(chunkId, newEmbedding, suggestedRelations);
  }
}
