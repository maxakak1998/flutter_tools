/**
 * Memory-bank importer parser.
 *
 * Pure parsing helpers for Module M7 (migration importer). Takes a flat-file
 * memory-bank decision log (markdown) and splits it into individual decision
 * entries suitable for the `decision_record` tool.
 *
 * This module has NO daemon / DB / IO-write dependencies — it only reads a file
 * and returns parsed entries. The CLI (`kg import-memory-bank`) drives the actual
 * ingestion by calling `decision_record` over JSON-RPC for each parsed entry.
 */

/** Max content length per decision — respect the 5000-char zod hard limit with headroom. */
export const MAX_DECISION_CONTENT = 4500;

/** Max summary length — matches the knowledge_store zod constraint. */
export const MAX_SUMMARY = 200;

export interface ParsedDecision {
  /** Heading text, used as the decision summary. */
  title: string;
  /** Section body (heading + content), trimmed and capped. */
  content: string;
  /** A few extracted keywords for search. */
  keywords: string[];
}

/**
 * Split raw markdown into decision sections keyed on `## ` headings.
 *
 * Each `## ` (level-2) heading starts a new section; everything until the next
 * `## ` (or EOF) is that section's body. Content preceding the first `## `
 * heading (preamble / title / `# ` heading) is ignored. `###` and deeper
 * headings stay inside their parent section.
 *
 * Returns entries with a non-empty title. Sections whose body is empty after
 * trimming are still included (the title carries the decision), but sections
 * with neither title nor body are dropped.
 */
export function parseDecisionLog(markdown: string): ParsedDecision[] {
  const lines = markdown.split(/\r?\n/);
  const decisions: ParsedDecision[] = [];

  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentTitle === null) return;
    const title = normalizeTitle(currentTitle);
    if (!title) {
      currentTitle = null;
      currentBody = [];
      return;
    }
    // Content = heading line + body, so the stored chunk keeps the decision title inline.
    const bodyText = currentBody.join('\n').trim();
    const rawContent = bodyText ? `${currentTitle.trim()}\n\n${bodyText}` : currentTitle.trim();
    const content = capContent(rawContent);
    decisions.push({
      title: title.slice(0, MAX_SUMMARY),
      content,
      keywords: extractKeywords(title, bodyText),
    });
    currentTitle = null;
    currentBody = [];
  };

  for (const line of lines) {
    // A level-2 heading (## Foo) starts a new decision section. Deeper headings (###+) do not.
    const isLevel2 = /^##\s+\S/.test(line) && !/^###/.test(line);
    if (isLevel2) {
      flush();
      currentTitle = line;
      currentBody = [];
    } else if (currentTitle !== null) {
      currentBody.push(line);
    }
    // Lines before the first `## ` heading are preamble — ignored.
  }
  flush();

  return decisions;
}

/** Strip leading `#` markers, surrounding markdown emphasis, and whitespace from a heading. */
function normalizeTitle(heading: string): string {
  return heading
    .replace(/^#+\s*/, '')
    .replace(/[*_`]+/g, '')
    .trim();
}

/** Cap content at MAX_DECISION_CONTENT chars, preferring a clean word boundary. */
function capContent(content: string): string {
  if (content.length <= MAX_DECISION_CONTENT) return content;
  const slice = content.slice(0, MAX_DECISION_CONTENT);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > MAX_DECISION_CONTENT * 0.8 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'was', 'are', 'were',
  'has', 'have', 'had', 'not', 'but', 'you', 'your', 'our', 'their', 'its',
  'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must', 'into',
  'over', 'under', 'when', 'what', 'why', 'how', 'who', 'which', 'because',
  'decision', 'decisions', 'log', 'note', 'notes', 'context', 'date',
]);

/**
 * Extract a handful of lowercased keyword terms from the title (weighted) and body.
 * Guarantees at least one keyword so the store's 1-item zod minimum is satisfied.
 */
export function extractKeywords(title: string, body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const w = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (w.length < 3 || STOPWORDS.has(w) || seen.has(w)) return;
    seen.add(w);
    out.push(w);
  };

  // Title terms first (higher signal), then body terms.
  for (const w of title.split(/\s+/)) {
    push(w);
    if (out.length >= 5) break;
  }
  if (out.length < 5) {
    for (const w of body.split(/\s+/)) {
      push(w);
      if (out.length >= 8) break;
    }
  }

  // The knowledge_store schema requires >= 1 keyword, each >= 2 chars.
  if (out.length === 0) out.push('imported');
  return out.slice(0, 8);
}
