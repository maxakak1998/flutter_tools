import { computeDecay } from '../engine/confidence.js';
import { IStorage } from '../storage/interface.js';
import { BriefingResult, DomainStatsCache } from '../types.js';
import type { CacheManager } from '../cache.js';

const LIFECYCLE_ORDER: Record<string, number> = {
  refuted: 0,
  hypothesis: 1,
  active: 2,
  validated: 3,
  promoted: 4,
  canonical: 5,
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function handleBriefing(
  storage: IStorage,
  decayRates: Record<string, number> | undefined,
  topDomains: number,
  recentDays: number,
  cacheManager?: CacheManager,
): Promise<BriefingResult> {
  const [stats, allChunks] = await Promise.all([
    storage.getStats(),
    storage.listChunks({}, 5000),
  ]);
  // Exclude operational/entity-index layers from domain briefing (cross-layer isolation)
  const chunks = allChunks.filter(c => c.layer !== 'operational' && c.layer !== 'entity-index');

  const now = Date.now();
  const recentThreshold = now - recentDays * 24 * 60 * 60 * 1000;
  const byLifecycle: Record<string, number> = {};
  const byCategory = { ...stats.by_category };

  const domains = new Map<string, {
    name: string;
    chunk_count: number;
    top_lifecycle: string;
    confidence_sum: number;
    open_questions: number;
    categories: Record<string, number>;
  }>();

  const recentChanges: BriefingResult['recent_changes'] = [];
  const openQuestions: BriefingResult['open_questions'] = [];
  const staleKnowledge: BriefingResult['stale_knowledge'] = [];

  for (const chunk of chunks) {
    byLifecycle[chunk.lifecycle] = (byLifecycle[chunk.lifecycle] ?? 0) + 1;

    const decayRate = decayRates?.[chunk.category] ?? decayRates?.default ?? 0.95;
    const effectiveConfidence = round3(computeDecay(chunk.confidence, chunk.last_validated_at, decayRate));
    const domainName = chunk.domain || 'unknown';

    const existing = domains.get(domainName) ?? {
      name: domainName,
      chunk_count: 0,
      top_lifecycle: chunk.lifecycle,
      confidence_sum: 0,
      open_questions: 0,
      categories: {},
    };

    existing.chunk_count += 1;
    existing.confidence_sum += effectiveConfidence;
    existing.categories[chunk.category] = (existing.categories[chunk.category] ?? 0) + 1;
    if ((LIFECYCLE_ORDER[chunk.lifecycle] ?? -1) > (LIFECYCLE_ORDER[existing.top_lifecycle] ?? -1)) {
      existing.top_lifecycle = chunk.lifecycle;
    }
    if (chunk.category === 'question' && (chunk.lifecycle === 'hypothesis' || chunk.lifecycle === 'active')) {
      existing.open_questions += 1;
    }
    domains.set(domainName, existing);

    const updatedAt = new Date(chunk.updated_at).getTime();
    if (!Number.isNaN(updatedAt) && updatedAt >= recentThreshold) {
      recentChanges.push({
        id: chunk.id,
        summary: chunk.summary,
        domain: domainName,
        category: chunk.category,
        updated_at: chunk.updated_at,
      });
    }

    if (chunk.category === 'question' && (chunk.lifecycle === 'hypothesis' || chunk.lifecycle === 'active')) {
      openQuestions.push({
        id: chunk.id,
        summary: chunk.summary,
        domain: domainName,
        confidence: round3(chunk.confidence),
      });
    }

    if (effectiveConfidence < 0.5 && chunk.confidence >= 0.5) {
      staleKnowledge.push({
        id: chunk.id,
        summary: chunk.summary,
        domain: domainName,
        effective_confidence: effectiveConfidence,
        last_validated_at: chunk.last_validated_at,
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const result: BriefingResult = {
    domains: Array.from(domains.values())
      .map((domain) => ({
        name: domain.name,
        chunk_count: domain.chunk_count,
        top_lifecycle: domain.top_lifecycle,
        avg_confidence: domain.chunk_count > 0 ? round3(domain.confidence_sum / domain.chunk_count) : 0,
        open_questions: domain.open_questions,
        categories: domain.categories,
      }))
      .sort((a, b) => b.chunk_count - a.chunk_count || a.name.localeCompare(b.name))
      .slice(0, topDomains),
    stats: {
      total_chunks: stats.total_chunks,
      total_edges: stats.total_edges,
      by_category: byCategory,
      by_lifecycle: byLifecycle,
    },
    recent_changes: recentChanges
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 20),
    open_questions: openQuestions.sort((a, b) => a.confidence - b.confidence || a.summary.localeCompare(b.summary)),
    stale_knowledge: staleKnowledge.sort((a, b) => a.effective_confidence - b.effective_confidence || a.summary.localeCompare(b.summary)),
    generated_at: generatedAt,
  };

  if (cacheManager) {
    cacheManager.write('briefing.json', result);
    const domainStatsCache: DomainStatsCache = {
      domains: result.domains.map((domain) => ({
        name: domain.name,
        chunk_count: domain.chunk_count,
        top_lifecycle: domain.top_lifecycle,
        avg_confidence: domain.avg_confidence,
      })),
      total_chunks: result.stats.total_chunks,
      total_edges: result.stats.total_edges,
      generated_at: generatedAt,
    };
    cacheManager.write('domain-stats.json', domainStatsCache);
  }

  return result;
}
