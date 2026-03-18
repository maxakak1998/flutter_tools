import { IStorage } from '../storage/interface.js';
import { Embedder } from './embedder.js';
import { computeDecay } from './confidence.js';
import {
  QueryResult,
  QueryChunk,
  QueryFilters,
  StoredChunk,
  StepEmitter,
  log,
} from '../types.js';

export class Retriever {
  constructor(
    private storage: IStorage,
    private embedder: Embedder,
    private learningConfig?: {
      confidenceSearchWeight: number;
      decayRates: Record<string, number>;
    },
  ) {}

  /**
   * Hybrid search: vector similarity + keyword/entity match + graph expansion + confidence boost.
   *
   * Pipeline:
   * 1. Embed query via Ollama
   * 2. Vector search (KuzuDB HNSW index)
   * 3. Entity/keyword boost from top hits
   * 4. Graph traversal from top vector hits
   * 5. Merge, deduplicate, rerank
   * 6. Confidence boost (decay-adjusted)
   * 7. Filter refuted chunks + post-filters
   * 8. Track access and return results
   */
  async search(query: string, filters?: QueryFilters, onStep?: StepEmitter): Promise<QueryResult> {
    const t0 = performance.now();

    // Step 1: Embed the query
    let queryEmbedding: number[];
    try {
      onStep?.('embedding', `Embedding: "${query.slice(0, 50)}"`);
      queryEmbedding = await this.embedder.embed(query);
      onStep?.('embedding_done', `Embedded in ${Math.round(performance.now() - t0)}ms`, {
        dimensions: queryEmbedding.length,
      });
    } catch (e) {
      log('Embedding failed, falling back to keyword-only search:', e);
      return this.keywordOnlySearch(query, filters);
    }

    // Step 2: Vector search — fetch generous candidate pool (graph expansion adds more)
    const vectorK = 50;
    const vectorHits = await this.storage.vectorSearch(queryEmbedding, vectorK, filters);
    onStep?.('vector_search', `Found ${vectorHits.length} vector candidates`, {
      hits: vectorHits.map(h => ({ id: h.chunk.id, summary: h.chunk.summary, distance: Math.round(h.distance * 1000) / 1000 }))
    });

    // Step 3: Extract keywords from query for boosting
    const queryTerms = this.extractTerms(query);
    onStep?.('keyword_extract', `Extracted ${queryTerms.length} terms`, { terms: queryTerms });

    // Step 4: Graph expansion — follow relationships from top vector hits
    const graphChunkIds = new Set<string>();
    const topHitIds = vectorHits.slice(0, 3).map(h => h.chunk.id);
    onStep?.('graph_expand', `Expanding from top ${topHitIds.length} hits`, { from_ids: topHitIds });
    for (const hitId of topHitIds) {
      try {
        const related = await this.storage.getRelatedChunks(hitId, 1);
        for (const r of related) {
          graphChunkIds.add(r.id);
        }
      } catch {
        // Graph traversal may fail for isolated nodes
      }
    }
    onStep?.('graph_expand_done', `Found ${graphChunkIds.size} related chunks via graph`);

    // Step 5: Merge and score all candidates
    const scoredChunks = new Map<string, { chunk: StoredChunk; score: number }>();

    // Score vector hits (weight: 0.55)
    for (const hit of vectorHits) {
      const vectorScore = 1 - hit.distance; // cosine distance → similarity
      scoredChunks.set(hit.chunk.id, {
        chunk: hit.chunk,
        score: vectorScore * 0.55,
      });
    }

    // Boost by keyword/entity match (weight: 0.2)
    for (const [, entry] of scoredChunks) {
      const keywordScore = this.computeKeywordScore(entry.chunk, queryTerms);
      entry.score += keywordScore * 0.2;
    }

    // Boost graph-connected chunks (weight: 0.2)
    for (const graphId of graphChunkIds) {
      if (scoredChunks.has(graphId)) {
        scoredChunks.get(graphId)!.score += 0.2;
      } else {
        // Fetch the chunk from storage if not already in results
        try {
          const chunk = await this.storage.getChunk(graphId);
          if (chunk) {
            scoredChunks.set(graphId, { chunk, score: 0.15 });
          }
        } catch {
          // Skip chunks we can't fetch
        }
      }
    }

    // Confidence boost (weight from config, default 0.1)
    const confidenceWeight = this.learningConfig?.confidenceSearchWeight ?? 0.1;
    for (const [, entry] of scoredChunks) {
      const decayRate = this.learningConfig?.decayRates?.[entry.chunk.category]
        ?? this.learningConfig?.decayRates?.['default'] ?? 0.95;
      const effectiveConfidence = computeDecay(
        entry.chunk.confidence,
        entry.chunk.last_validated_at,
        decayRate
      );
      const confidenceBoost = (effectiveConfidence - 0.5) * confidenceWeight;
      entry.score += confidenceBoost;
    }

    onStep?.('score_merge', `Merged ${scoredChunks.size} candidates`, {
      top_scores: [...scoredChunks.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 10).map(([id, e]) => ({ id, score: Math.round(e.score * 1000) / 1000 }))
    });

    // Step 6: Sort by score (return full network neighborhood)
    const candidates = [...scoredChunks.values()];
    const selected = candidates.sort((a, b) => b.score - a.score);

    // Filter out refuted chunks unless explicitly requested
    const includeRefuted = filters?.lifecycle === 'refuted';
    const filtered = selected.filter(s => includeRefuted || s.chunk.lifecycle !== 'refuted');

    // Post-filters for new filter types
    let postFiltered = filtered;
    if (filters?.min_confidence !== undefined) {
      // Use effective (decayed) confidence, not raw — consistent with knowledge_list
      postFiltered = postFiltered.filter(s => {
        const decayRate = this.learningConfig?.decayRates?.[s.chunk.category]
          ?? this.learningConfig?.decayRates?.['default'] ?? 0.95;
        const effective = computeDecay(s.chunk.confidence, s.chunk.last_validated_at, decayRate);
        return effective >= filters.min_confidence!;
      });
    }
    if (filters?.lifecycle && filters.lifecycle !== 'refuted') {
      postFiltered = postFiltered.filter(s => s.chunk.lifecycle === filters.lifecycle);
    }
    if (filters?.since) {
      postFiltered = postFiltered.filter(s => s.chunk.updated_at >= filters.since!);
    }

    onStep?.('final_rank', `Returning ${postFiltered.length} results`, {
      selected: postFiltered.map(s => ({ id: s.chunk.id, summary: s.chunk.summary, score: Math.round(s.score * 1000) / 1000 }))
    });

    // Track access
    const returnedIds = postFiltered.map(s => s.chunk.id);
    if (returnedIds.length > 0) {
      this.storage.incrementAccessCount(returnedIds).catch(() => {});
    }

    // Build results
    const chunks: QueryChunk[] = postFiltered.map(({ chunk, score }) => ({
      id: chunk.id,
      content: chunk.content,
      metadata: {
        summary: chunk.summary,
        keywords: chunk.keywords,
        domain: chunk.domain,
        category: chunk.category as QueryChunk['metadata']['category'],
        importance: chunk.importance as QueryChunk['metadata']['importance'],
        layer: chunk.layer ?? undefined,
        entities: chunk.entities,
        tags: chunk.tags,
        source: chunk.source ?? undefined,
        version: chunk.version,
        created_at: chunk.created_at,
        updated_at: chunk.updated_at,
        confidence: chunk.confidence,
        lifecycle: chunk.lifecycle,
        validation_count: chunk.validation_count,
        access_count: chunk.access_count,
      },
      score: Math.round(score * 1000) / 1000,
    }));

    return { chunks, total: chunks.length };
  }


  /**
   * Keyword-only search fallback (when embedding fails).
   * Skips MMR since no embeddings are available.
   */
  private async keywordOnlySearch(
    query: string,
    filters: QueryFilters | undefined,
  ): Promise<QueryResult> {
    const terms = this.extractTerms(query);
    const allChunks: StoredChunk[] = [];

    for (const term of terms.slice(0, 5)) {
      try {
        const found = await this.storage.findChunksByKeyword(term);
        allChunks.push(...found);
      } catch {
        // Skip terms that don't match
      }
    }

    // Deduplicate and score
    const seen = new Map<string, { chunk: StoredChunk; score: number }>();
    for (const chunk of allChunks) {
      if (filters?.domain && chunk.domain !== filters.domain) continue;
      if (filters?.category && chunk.category !== filters.category) continue;
      if (filters?.importance && chunk.importance !== filters.importance) continue;

      const existing = seen.get(chunk.id);
      if (existing) {
        existing.score += 0.1;
      } else {
        seen.set(chunk.id, {
          chunk,
          score: this.computeKeywordScore(chunk, terms),
        });
      }
    }

    let sorted = [...seen.values()]
      .sort((a, b) => b.score - a.score);

    // Filter out refuted chunks unless explicitly requested
    const includeRefuted = filters?.lifecycle === 'refuted';
    sorted = sorted.filter(s => includeRefuted || s.chunk.lifecycle !== 'refuted');

    // Post-filters — use effective (decayed) confidence, consistent with knowledge_list
    if (filters?.min_confidence !== undefined) {
      sorted = sorted.filter(s => {
        const decayRate = this.learningConfig?.decayRates?.[s.chunk.category]
          ?? this.learningConfig?.decayRates?.['default'] ?? 0.95;
        const effective = computeDecay(s.chunk.confidence, s.chunk.last_validated_at, decayRate);
        return effective >= filters.min_confidence!;
      });
    }
    if (filters?.lifecycle && filters.lifecycle !== 'refuted') {
      sorted = sorted.filter(s => s.chunk.lifecycle === filters.lifecycle);
    }
    if (filters?.since) {
      sorted = sorted.filter(s => s.chunk.updated_at >= filters.since!);
    }

    // Track access
    const returnedIds = sorted.map(s => s.chunk.id);
    if (returnedIds.length > 0) {
      this.storage.incrementAccessCount(returnedIds).catch(() => {});
    }

    const chunks: QueryChunk[] = sorted.map(({ chunk, score }) => ({
      id: chunk.id,
      content: chunk.content,
      metadata: {
        summary: chunk.summary,
        keywords: chunk.keywords,
        domain: chunk.domain,
        category: chunk.category as QueryChunk['metadata']['category'],
        importance: chunk.importance as QueryChunk['metadata']['importance'],
        layer: chunk.layer ?? undefined,
        entities: chunk.entities,
        tags: chunk.tags,
        source: chunk.source ?? undefined,
        version: chunk.version,
        created_at: chunk.created_at,
        updated_at: chunk.updated_at,
        confidence: chunk.confidence,
        lifecycle: chunk.lifecycle,
        validation_count: chunk.validation_count,
        access_count: chunk.access_count,
      },
      score: Math.round(score * 1000) / 1000,
    }));

    return { chunks, total: chunks.length };
  }

  /**
   * Extract search terms from a query string.
   */
  private extractTerms(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
      .filter((t, i, arr) => arr.indexOf(t) === i);
  }

  /**
   * Compute keyword/entity match score for a chunk against query terms.
   */
  private computeKeywordScore(chunk: StoredChunk, queryTerms: string[]): number {
    let score = 0;
    const chunkTerms = new Set([
      ...chunk.keywords.map(k => k.toLowerCase()),
      ...chunk.entities.map(e => e.toLowerCase()),
      ...chunk.tags.map(t => t.toLowerCase()),
      chunk.domain.toLowerCase(),
    ]);

    for (const term of queryTerms) {
      if (chunkTerms.has(term)) {
        score += 0.3;
      } else {
        // Partial match
        for (const ct of chunkTerms) {
          if (ct.includes(term) || term.includes(ct)) {
            score += 0.1;
            break;
          }
        }
      }
    }

    return Math.min(score, 1.0);
  }
}
