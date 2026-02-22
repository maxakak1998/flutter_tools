import { KuzuStorage } from '../storage/kuzu.js';
import { Embedder } from './embedder.js';
import {
  QueryResult,
  QueryChunk,
  QueryFilters,
  StoredChunk,
  StepEmitter,
  log,
} from '../types.js';
import { DEFAULT_CONFIG } from '../config.js';

export class Retriever {
  constructor(
    private storage: KuzuStorage,
    private embedder: Embedder,
    private defaultQueryLimit = DEFAULT_CONFIG.search.defaultLimit,
  ) {}

  /**
   * Hybrid search: vector similarity + keyword/entity match + graph expansion + MMR rerank.
   *
   * Pipeline:
   * 1. Embed query via Ollama
   * 2. Vector search (KuzuDB HNSW index)
   * 3. Entity/keyword boost from top hits
   * 4. Graph traversal from top vector hits
   * 5. Merge, deduplicate, rerank
   * 6. MMR reranking for diversity
   * 7. Return top N with metadata + code links
   */
  async search(query: string, filters?: QueryFilters, onStep?: StepEmitter): Promise<QueryResult> {
    const limit = filters?.limit ?? this.defaultQueryLimit;
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
      return this.keywordOnlySearch(query, filters, limit);
    }

    // Step 2: Vector search — get top K * 2 candidates (extra for reranking)
    const vectorK = Math.min(limit * 2, 20);
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

    // Score vector hits (weight: 0.6)
    for (const hit of vectorHits) {
      const vectorScore = 1 - hit.distance; // cosine distance → similarity
      scoredChunks.set(hit.chunk.id, {
        chunk: hit.chunk,
        score: vectorScore * 0.6,
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

    onStep?.('score_merge', `Merged ${scoredChunks.size} candidates`, {
      top_scores: [...scoredChunks.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 10).map(([id, e]) => ({ id, score: Math.round(e.score * 1000) / 1000 }))
    });

    // Step 6: MMR reranking for diversity
    const candidates = [...scoredChunks.values()];
    const selected = this.mmrRerank(candidates, limit);
    onStep?.('mmr_rerank', `MMR selected ${selected.length} diverse results`, {
      selected: selected.map(s => ({ id: s.chunk.id, summary: s.chunk.summary, score: Math.round(s.score * 1000) / 1000 }))
    });

    // Step 7: Enrich with code links
    const chunks: QueryChunk[] = await Promise.all(
      selected.map(async ({ chunk, score }) => {
        const codeLinks = await this.getCodeLinks(chunk.id);
        return {
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
          },
          score: Math.round(score * 1000) / 1000,
          code_links: codeLinks,
        };
      })
    );

    return { chunks, total: chunks.length };
  }

  /**
   * MMR (Maximal Marginal Relevance) reranking.
   *
   * Iteratively selects chunks that are both high-scoring AND dissimilar
   * to already-selected chunks. Balances relevance vs diversity.
   *
   * MMR(d) = λ * score(d) - (1-λ) * max(similarity(d, selected))
   *
   * @param lambda - Balance factor: 1.0 = pure relevance, 0.0 = pure diversity.
   *                 0.7 favors relevance (appropriate for small corpora).
   */
  private mmrRerank(
    candidates: Array<{ chunk: StoredChunk; score: number }>,
    limit: number,
    lambda = 0.7
  ): Array<{ chunk: StoredChunk; score: number }> {
    if (candidates.length <= limit) return candidates;

    // Filter out candidates without embeddings (graph-only hits)
    const withEmbeddings = candidates.filter(c => c.chunk.embedding.length > 0);
    const withoutEmbeddings = candidates.filter(c => c.chunk.embedding.length === 0);

    if (withEmbeddings.length === 0) {
      // No embeddings available — fall back to score-only ranking
      return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    const selected: Array<{ chunk: StoredChunk; score: number }> = [];
    const remaining = new Set(withEmbeddings.map((_, i) => i));

    // Normalize scores to [0, 1] for fair MMR comparison
    const maxScore = Math.max(...withEmbeddings.map(c => c.score));
    const minScore = Math.min(...withEmbeddings.map(c => c.score));
    const scoreRange = maxScore - minScore || 1;

    while (selected.length < limit && remaining.size > 0) {
      let bestIdx = -1;
      let bestMmr = -Infinity;

      for (const idx of remaining) {
        const candidate = withEmbeddings[idx];
        const normalizedScore = (candidate.score - minScore) / scoreRange;

        // Max similarity to any already-selected chunk
        let maxSim = 0;
        for (const sel of selected) {
          const sim = this.cosineSimilarity(candidate.chunk.embedding, sel.chunk.embedding);
          if (sim > maxSim) maxSim = sim;
        }

        const mmrScore = lambda * normalizedScore - (1 - lambda) * maxSim;
        if (mmrScore > bestMmr) {
          bestMmr = mmrScore;
          bestIdx = idx;
        }
      }

      if (bestIdx === -1) break;
      selected.push(withEmbeddings[bestIdx]);
      remaining.delete(bestIdx);
    }

    // Append non-embedding candidates if we still have room
    if (selected.length < limit && withoutEmbeddings.length > 0) {
      withoutEmbeddings.sort((a, b) => b.score - a.score);
      for (const c of withoutEmbeddings) {
        if (selected.length >= limit) break;
        selected.push(c);
      }
    }

    return selected;
  }

  /** Cosine similarity between two vectors. Returns value in [-1, 1]. */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Keyword-only search fallback (when embedding fails).
   * Skips MMR since no embeddings are available.
   */
  private async keywordOnlySearch(
    query: string,
    filters: QueryFilters | undefined,
    limit: number
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

    const sorted = [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const chunks: QueryChunk[] = await Promise.all(
      sorted.map(async ({ chunk, score }) => ({
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
        },
        score: Math.round(score * 1000) / 1000,
        code_links: await this.getCodeLinks(chunk.id),
      }))
    );

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

  /**
   * Get code entity links for a chunk.
   */
  private async getCodeLinks(chunkId: string): Promise<QueryChunk['code_links']> {
    try {
      const links = await this.storage.getCodeLinksForChunk(chunkId);
      return links.map(l => ({
        name: l.entity.name,
        type: l.entity.entity_type,
        path: l.entity.file_path + (l.entity.line_start ? `:${l.entity.line_start}` : ''),
        relation: l.relation,
        description: l.description ?? undefined,
      }));
    } catch {
      return [];
    }
  }
}
