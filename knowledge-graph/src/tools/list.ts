import { IStorage } from '../storage/interface.js';
import { ListFilters, ListResult, StoredChunk } from '../types.js';
import { computeDecay } from '../engine/confidence.js';

export async function handleList(
  storage: IStorage,
  filters: ListFilters,
  limit = 50,
  decayRates?: Record<string, number>,
): Promise<ListResult> {
  // Extract min_confidence from filters — apply AFTER decay, not in storage query
  const minConfidence = filters.min_confidence;
  const storageFilters = { ...filters };
  delete storageFilters.min_confidence;

  const chunks = await storage.listChunks(storageFilters, limit);

  // Exclude operational/entity-index layers by default (cross-layer isolation)
  const isExplicitLayer = storageFilters.layer === 'operational' || storageFilters.layer === 'entity-index';
  const layerFiltered = isExplicitLayer
    ? chunks
    : chunks.filter((c: StoredChunk) => c.layer !== 'operational' && c.layer !== 'entity-index');

  // Compute effective confidence (with temporal decay) and filter
  const enriched = layerFiltered.map((c: StoredChunk) => {
    const decayRate = decayRates?.[c.category] ?? decayRates?.['default'] ?? 0.95;
    const effectiveConfidence = computeDecay(c.confidence, c.last_validated_at, decayRate);
    return { chunk: c, effectiveConfidence: Math.round(effectiveConfidence * 1000) / 1000 };
  });

  // Apply min_confidence on EFFECTIVE (decayed) confidence, not raw
  const filtered = minConfidence != null
    ? enriched.filter(e => e.effectiveConfidence >= minConfidence)
    : enriched;

  return {
    chunks: filtered.map(({ chunk: c, effectiveConfidence }) => ({
      id: c.id,
      summary: c.summary,
      domain: c.domain,
      category: c.category,
      importance: c.importance,
      layer: c.layer,
      source: c.source,
      version: c.version,
      updated_at: c.updated_at,
      tags: c.tags,
      confidence: c.confidence,
      effective_confidence: effectiveConfidence,
      lifecycle: c.lifecycle,
      validation_count: c.validation_count,
      access_count: c.access_count,
      last_validated_at: c.last_validated_at,
    })),
    total: filtered.length,
  };
}
