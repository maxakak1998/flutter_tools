import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { SessionStateRow, log } from '../types.js';

// === Result types ===

/** Per-session fold record — what was folded in one session. */
export interface CompactSessionSummary {
  session_id: string;
  folded: number;
  summary_id: string;
  from: string;
  to: string;
}

export interface StateCompactResult {
  project_id: string;
  keep_recent: number;
  compacted_count: number;
  sessions_affected: number;
  summaries: CompactSessionSummary[];
  message: string;
}

export interface StateCompactOptions {
  /** Newest N events per session that are always protected (default 50). */
  keepRecent?: number;
  /** Scope compaction to a single session (used by the opportunistic daemon path). */
  sessionId?: string;
}

// Only the ephemeral working-memory stream is ever folded — the append-only
// active_context trail plus previously-produced 'event' summaries. Plans and
// tasks are durable ledger rows and are NEVER compacted.
const COMPACT_ARTIFACTS = ['active_context', 'event'] as const;
const DEFAULT_KEEP_RECENT = 50;
const SUMMARY_ARTIFACT = 'event';

// Caps so the summary body itself stays terse (it is bounded working memory too).
const MAX_FOCUSES = 20;
const MAX_REFS = 30;

/** Newest-first by created_at (ISO-8601 lexicographic == chronological). */
function byNewest(rows: SessionStateRow[]): SessionStateRow[] {
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Group candidate rows by session_id. */
function groupBySession(rows: SessionStateRow[]): Map<string, SessionStateRow[]> {
  const map = new Map<string, SessionStateRow[]>();
  for (const row of rows) {
    const list = map.get(row.session_id);
    if (list) list.push(row);
    else map.set(row.session_id, [row]);
  }
  return map;
}

/** Extract a distinct, capped list preserving first-seen order. */
function distinctCapped(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Fold a session's older working-memory rows into one summary 'event' row.
 * Returns the fold record, or null when the session has nothing to compact.
 *
 * `foldCandidates` are the OLDER unpinned rows (already past the keepRecent
 * window). They are summarised into a single event row, then soft-evicted.
 */
async function foldSession(
  storage: IStorage,
  sessionId: string,
  projectId: string,
  foldCandidates: SessionStateRow[],
  nowIso: string,
): Promise<CompactSessionSummary | null> {
  if (foldCandidates.length === 0) return null;

  // Oldest-first so the summary reads chronologically and the date range is stable.
  const chrono = [...foldCandidates].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
  const from = chrono[0].created_at;
  const to = chrono[chrono.length - 1].created_at;

  const focuses = distinctCapped(chrono.map((r) => r.title).filter((t) => !!t), MAX_FOCUSES);
  const refs = distinctCapped(chrono.flatMap((r) => r.refs ?? []), MAX_REFS);

  const count = chrono.length;
  const summaryBody = {
    compacted: true,
    count,
    from,
    to,
    focuses,
    refs,
    note: `Compacted ${count} older working-memory event(s) spanning ${from} .. ${to}.`,
  };

  const summaryId = randomUUID();
  await storage.createSessionState({
    id: summaryId,
    session_id: sessionId,
    project_id: projectId,
    artifact_type: SUMMARY_ARTIFACT,
    status: 'compacted',
    title: `[compacted ${count} events]`,
    body: JSON.stringify(summaryBody),
    refs,
    version: 1,
    pinned: false,
    active: true,
    created_at: nowIso,
    updated_at: nowIso,
    last_touched_at: nowIso,
  });

  // Soft-evict the folded originals — out of the working stream, still stored.
  for (const row of chrono) {
    await storage.updateSessionState(row.id, { active: false, updated_at: nowIso });
  }

  return { session_id: sessionId, folded: count, summary_id: summaryId, from, to };
}

/**
 * state_compact handler.
 *
 * Keeps the SessionState working-memory stream (active_context + event rows)
 * bounded. For each session whose active working-memory count exceeds
 * `keepRecent`, the OLDER rows (beyond the newest keepRecent) are folded into a
 * single summary 'event' row and the originals are soft-evicted (active=false).
 *
 * GUARDS (checkpoint-anchored + pinned-immune):
 * - NEVER compacts pinned=true rows (protected from GC entirely).
 * - NEVER compacts 'plan' or 'task' rows (only active_context/event).
 * - NEVER compacts rows inside the newest keepRecent window — that window is the
 *   implicit checkpoint anchor (the most recent state is always kept verbatim).
 */
export async function handleStateCompact(
  storage: IStorage,
  projectId: string,
  opts?: StateCompactOptions,
): Promise<StateCompactResult> {
  const keepRecent =
    opts?.keepRecent !== undefined && Number.isFinite(opts.keepRecent) && opts.keepRecent > 0
      ? Math.floor(opts.keepRecent)
      : DEFAULT_KEEP_RECENT;
  const nowIso = new Date().toISOString();

  // Gather the compactable working-memory rows (active only) across the project,
  // optionally scoped to a single session for the opportunistic hot path.
  const rowGroups = await Promise.all(
    COMPACT_ARTIFACTS.map((artifact_type) =>
      storage.listSessionState({
        project_id: projectId,
        artifact_type,
        active: true,
        ...(opts?.sessionId ? { session_id: opts.sessionId } : {}),
      }),
    ),
  );
  const candidates = rowGroups.flat();

  const bySession = groupBySession(candidates);
  const summaries: CompactSessionSummary[] = [];
  let compactedCount = 0;

  for (const [sessionId, rows] of bySession) {
    // Sort newest-first; the newest keepRecent are the protected anchor window.
    const sorted = byNewest(rows);
    if (sorted.length <= keepRecent) continue;

    // Older rows beyond the anchor — drop pinned ones (never compacted).
    const older = sorted.slice(keepRecent);
    const foldCandidates = older.filter((r) => !r.pinned);
    if (foldCandidates.length === 0) continue;

    const summary = await foldSession(storage, sessionId, projectId, foldCandidates, nowIso);
    if (summary) {
      summaries.push(summary);
      compactedCount += summary.folded;
    }
  }

  log(
    'state_compact: folded',
    compactedCount,
    'event(s) across',
    summaries.length,
    'session(s) in',
    projectId,
    `(keepRecent=${keepRecent})`,
  );

  return {
    project_id: projectId,
    keep_recent: keepRecent,
    compacted_count: compactedCount,
    sessions_affected: summaries.length,
    summaries,
    message:
      compactedCount === 0
        ? `Nothing to compact — no session exceeds ${keepRecent} active working-memory events.`
        : `Folded ${compactedCount} older event(s) into ${summaries.length} summary snapshot(s). Pinned rows, plans, tasks, and the newest ${keepRecent} events per session were left untouched.`,
  };
}
