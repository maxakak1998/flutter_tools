import { Embedder } from '../engine/embedder.js';
import { IStorage } from '../storage/interface.js';
import { ChunkCategory, IngestCandidate, IngestResult } from '../types.js';

function toKebabCase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function splitLongSegment(segment: string, maxLen = 1000): string[] {
  if (segment.length <= maxLen) return [segment.trim()];

  const sentences = segment.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [segment.trim()];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function chunkText(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const headingSplit = normalized
    .split(/\n(?=##\s|###\s)/)
    .map((section) => section.trim())
    .filter(Boolean);

  const rawSegments = headingSplit.flatMap((section) =>
    section
      .split(/\n\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean),
  );

  const merged: string[] = [];
  for (const segment of rawSegments) {
    if (segment.length < 100 && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n\n${segment}`.trim();
    } else {
      merged.push(segment);
    }
  }

  return merged
    .flatMap((segment) => splitLongSegment(segment, 1000))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 20 && segment.trim().length > 0);
}

function inferCategory(segment: string): ChunkCategory {
  const text = segment.trim();
  const lower = text.toLowerCase();

  if (text.includes('?') || /^(why|how|what)\b/i.test(text)) {
    return 'question';
  }
  if (/(^|\b)(must|should|never|always|required)\b/i.test(lower)) {
    return 'rule';
  }
  if (/(^|\b)(step|flow|process|then|next|after that|before)\b/i.test(lower)) {
    return 'workflow';
  }
  if (/(^|\b)(because|reason|it seems|appears)\b/i.test(lower)) {
    return 'insight';
  }
  return 'fact';
}

function extractHeading(segment: string): string | null {
  const firstLine = segment.split('\n')[0]?.trim() ?? '';
  if (/^#{2,3}\s+/.test(firstLine)) {
    return firstLine.replace(/^#{2,3}\s+/, '').trim();
  }
  return null;
}

function generateSummary(segment: string): string {
  const heading = extractHeading(segment);
  if (heading) return heading.slice(0, 200);

  const firstSentence = segment
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]?/)?.[0]
    ?.trim();

  if (firstSentence) return firstSentence.slice(0, 200);
  return segment.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function inferDomain(segment: string, domainHint?: string): string {
  if (domainHint?.trim()) return toKebabCase(domainHint);
  const heading = extractHeading(segment);
  if (heading) return toKebabCase(heading).slice(0, 50) || 'general';
  return 'general';
}

export async function handleIngest(
  storage: IStorage,
  embedder: Embedder,
  content: string,
  source?: string,
  domainHint?: string,
  dedupThreshold = 0.88,
): Promise<IngestResult> {
  const segments = chunkText(content);
  const candidates: IngestCandidate[] = [];
  let duplicates = 0;

  for (const [index, segment] of segments.entries()) {
    const embedding = await embedder.embed(segment);
    const [topHit] = await storage.vectorSearchUnfiltered(embedding, 1);

    const candidate: IngestCandidate = {
      segment_index: index,
      content: segment,
      suggested_category: inferCategory(segment),
      suggested_domain: inferDomain(segment, domainHint),
      suggested_summary: generateSummary(segment),
    };

    if (topHit) {
      const similarity = 1 - topHit.distance;
      if (similarity >= dedupThreshold) {
        duplicates += 1;
        candidate.duplicate_of = topHit.chunk.id;
        candidate.duplicate_similarity = Math.round(similarity * 1000) / 1000;
        candidate.duplicate_summary = topHit.chunk.summary;
      }
    }

    candidates.push(candidate);
  }

  return {
    candidates,
    stats: {
      total_segments: segments.length,
      duplicates,
      new_candidates: candidates.length - duplicates,
    },
    source,
  };
}
