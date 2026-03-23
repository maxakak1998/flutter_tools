import { IStorage } from '../storage/interface.js';
import { StoredChunk, LifeDraftSkillResult, log } from '../types.js';

// === Recognized life:* tag categories and their section headings ===

const LIFE_TAG_SECTIONS: Record<string, string> = {
  'life:gotcha': 'Common Gotchas',
  'life:pattern': 'Preferred Patterns',
  'life:anti-pattern': 'Anti-Patterns to Avoid',
  'life:workaround': 'Workarounds',
  'life:tool-limitation': 'Tool Limitations',
};

const RECOGNIZED_LIFE_TAGS = new Set(Object.keys(LIFE_TAG_SECTIONS));

// === Handler ===

export async function handleLifeDraftSkill(
  storage: IStorage,
  config: { operational: { draftSkillMinEntries: number } },
  domain: string,
  targetSkillPath?: string,
  force?: boolean,
): Promise<LifeDraftSkillResult> {
  // 1. List chunks in the operational layer for the given domain
  const chunks = await storage.listChunks({ layer: 'operational', domain }, 1000);

  // 2. Filter: score === 10 (Math.round(confidence * 10) === 10) AND lifecycle !== 'refuted'
  const eligible = chunks.filter(
    (c) => Math.round(c.confidence * 10) === 10 && c.lifecycle !== 'refuted',
  );

  // 3. Check threshold (unless force is set)
  if (eligible.length < config.operational.draftSkillMinEntries && !force) {
    throw new Error(
      `Not enough eligible entries to draft a skill for domain "${domain}". ` +
      `Found ${eligible.length} entries with score 10 (need ${config.operational.draftSkillMinEntries}). ` +
      `Use force=true to override this threshold, or validate more operational learnings to score 10.`,
    );
  }

  // 4. Group entries by life:* tag type
  const grouped: Record<string, StoredChunk[]> = {};
  const uncategorized: StoredChunk[] = [];

  for (const chunk of eligible) {
    const lifeTags = chunk.tags.filter((t) => RECOGNIZED_LIFE_TAGS.has(t));
    if (lifeTags.length === 0) {
      uncategorized.push(chunk);
    } else {
      for (const tag of lifeTags) {
        if (!grouped[tag]) grouped[tag] = [];
        grouped[tag].push(chunk);
      }
    }
  }

  // 5. Generate draft SKILL.md content
  const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const entryIds = eligible.map((c) => c.id);
  const suggestedPath = targetSkillPath ?? `.claude/skills/${domain}/SKILL.md`;

  const sections: string[] = [];

  // Front matter
  sections.push(`---`);
  sections.push(`name: ${domain}`);
  sections.push(`description: "Auto-generated from ${eligible.length} validated operational learnings"`);
  sections.push(`---`);
  sections.push('');
  sections.push(`# ${formatDomainTitle(domain)} — Operational Knowledge`);
  sections.push('');

  // Emit each recognized section (only if it has entries)
  for (const [tag, heading] of Object.entries(LIFE_TAG_SECTIONS)) {
    const entries = grouped[tag];
    if (!entries || entries.length === 0) continue;

    sections.push(`## ${heading}`);
    for (const entry of entries) {
      const truncated = truncateContent(entry.content, 200);
      sections.push(`- **${entry.summary}**: ${truncated}`);
    }
    sections.push('');
  }

  // Uncategorized section (only if there are entries with no recognized life:* tag)
  if (uncategorized.length > 0) {
    sections.push(`## Uncategorized`);
    for (const entry of uncategorized) {
      const truncated = truncateContent(entry.content, 200);
      sections.push(`- **${entry.summary}**: ${truncated}`);
    }
    sections.push('');
  }

  // Footer
  sections.push(`---`);
  sections.push(`Source: ${eligible.length} operational learnings, promoted on ${now}`);
  sections.push(`Entry IDs: ${entryIds.join(', ')}`);
  sections.push('');

  const skillContent = sections.join('\n');

  // 6. Mark promoted: update lifecycle to 'promoted' for each eligible chunk
  for (const chunk of eligible) {
    await storage.updateChunk(chunk.id, { lifecycle: 'promoted' });
  }

  log(
    `Drafted skill for domain "${domain}":`,
    eligible.length,
    'entries promoted,',
    'suggested path:',
    suggestedPath,
  );

  // Build result entries
  const resultEntries = eligible.map((c) => ({
    id: c.id,
    summary: c.summary,
    score: Math.round(c.confidence * 10),
    tags: c.tags,
    source: c.source ?? undefined,
  }));

  return {
    promoted_count: eligible.length,
    skill_path: suggestedPath,
    skill_content: skillContent,
    entries: resultEntries,
    draft_ready: true,
  };
}

// === Helpers ===

/** Truncate content to maxLen characters, appending ellipsis if truncated. */
function truncateContent(content: string, maxLen: number): string {
  // Normalize whitespace for display
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen - 3).trimEnd() + '...';
}

/** Convert kebab-case domain to a title: "state-management" -> "State Management". */
function formatDomainTitle(domain: string): string {
  return domain
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
