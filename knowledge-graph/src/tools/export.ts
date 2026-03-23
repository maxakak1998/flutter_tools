import { computeDecay } from '../engine/confidence.js';
import { IStorage } from '../storage/interface.js';
import { ExportResult, StoredChunk } from '../types.js';

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

function escapeMarkdown(value: string): string {
  return value.replace(/([#*_`])/g, '\\$1');
}

export async function handleExport(
  storage: IStorage,
  groupBy: 'domain' | 'category' | 'lifecycle',
  minLifecycle: keyof typeof LIFECYCLE_ORDER | undefined,
  format: 'markdown' | 'json',
  includeContent: boolean,
  decayRates?: Record<string, number>,
): Promise<ExportResult> {
  const allChunks = await storage.listChunks({}, 10000);
  // Exclude operational/entity-index layers from domain export (cross-layer isolation)
  const chunks = allChunks.filter(c => c.layer !== 'operational' && c.layer !== 'entity-index');
  const minLevel = minLifecycle ? LIFECYCLE_ORDER[minLifecycle] : undefined;

  let excludedRefuted = 0;
  const filtered = chunks.filter((chunk) => {
    if (minLevel === undefined) return true;
    if (chunk.lifecycle === 'refuted' && minLevel > LIFECYCLE_ORDER.refuted) {
      excludedRefuted += 1;
    }
    return (LIFECYCLE_ORDER[chunk.lifecycle] ?? -1) >= minLevel;
  });

  const grouped = new Map<string, StoredChunk[]>();
  for (const chunk of filtered) {
    const key = groupBy === 'domain'
      ? (chunk.domain || 'unknown')
      : groupBy === 'category'
        ? chunk.category
        : chunk.lifecycle;
    const list = grouped.get(key) ?? [];
    list.push(chunk);
    grouped.set(key, list);
  }

  const byGroup = Object.fromEntries(
    Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => [key, value.length]),
  );

  let content: string;
  if (format === 'json') {
    const payload = {
      generated_at: new Date().toISOString(),
      group_by: groupBy,
      min_lifecycle: minLifecycle ?? null,
      include_content: includeContent,
      groups: Object.fromEntries(
        Array.from(grouped.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, value]) => [
            key,
            value.map((chunk) => {
              const decayRate = decayRates?.[chunk.category] ?? decayRates?.default ?? 0.95;
              const effectiveConfidence = round3(computeDecay(chunk.confidence, chunk.last_validated_at, decayRate));
              return {
                id: chunk.id,
                summary: chunk.summary,
                domain: chunk.domain,
                category: chunk.category,
                lifecycle: chunk.lifecycle,
                importance: chunk.importance,
                confidence: round3(chunk.confidence),
                effective_confidence: effectiveConfidence,
                updated_at: chunk.updated_at,
                ...(includeContent ? { content: chunk.content } : {}),
              };
            }),
          ]),
      ),
    };
    content = JSON.stringify(payload, null, 2);
  } else {
    const lines: string[] = [];
    lines.push('# Knowledge Graph Export');
    lines.push('');
    lines.push(`Generated at: ${new Date().toISOString()}`);
    lines.push(`Grouped by: ${groupBy}`);
    if (minLifecycle) lines.push(`Min lifecycle: ${minLifecycle}`);
    lines.push('');

    for (const [group, groupChunks] of Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`## ${escapeMarkdown(group)} (${groupChunks.length})`);
      lines.push('');

      for (const chunk of groupChunks.sort((a, b) => a.summary.localeCompare(b.summary))) {
        const decayRate = decayRates?.[chunk.category] ?? decayRates?.default ?? 0.95;
        const effectiveConfidence = round3(computeDecay(chunk.confidence, chunk.last_validated_at, decayRate));
        lines.push(`### ${escapeMarkdown(chunk.summary)}`);
        lines.push(`- Lifecycle: \`${chunk.lifecycle}\``);
        lines.push(`- Confidence: ${round3(chunk.confidence)} (effective: ${effectiveConfidence})`);
        lines.push(`- Importance: ${chunk.importance}`);
        lines.push(`- Domain: ${chunk.domain || 'unknown'}`);
        lines.push(`- Category: ${chunk.category}`);
        lines.push(`- Updated: ${chunk.updated_at}`);
        if (includeContent) {
          lines.push('');
          lines.push(chunk.content);
        }
        lines.push('');
      }
    }

    content = lines.join('\n');
  }

  return {
    content,
    stats: {
      total_exported: filtered.length,
      by_group: byGroup,
      excluded_refuted: excludedRefuted,
    },
    format,
  };
}
