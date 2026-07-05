import { IStorage } from '../storage/interface.js';
import { SessionStateRow, log } from '../types.js';

// === Result types ===

/** One orphaned intention — a task/event nobody returned to. */
export interface OrphanEntry {
  id: string;
  artifact_type: string;
  title: string;
  status: string;
  session_id: string;
  created_at: string;
  last_touched_at: string;
  age_days: number;
}

export interface StatePruneResult {
  project_id: string;
  mode: 'surface' | 'evict';
  older_than_days: number;
  cutoff: string;
  /** In 'surface' mode: orphans found (unmodified). In 'evict' mode: the rows just soft-evicted. */
  orphaned: OrphanEntry[];
  evicted_count: number;
  message: string;
}

// Anti-orphaning only ever considers deferred-prone working state — never plans,
// never durable knowledge. Tasks are the classic "do later" garbage; active_context
// rows with artifact_type 'event' are intentions recorded but never revisited.
const ORPHAN_ARTIFACTS = ['task', 'event'] as const;
const DEFAULT_OLDER_THAN_DAYS = 7;

/** Whole-days elapsed since an ISO timestamp (0 if unparseable/future). */
function ageDays(iso: string, nowMs: number): number {
  if (!iso) return 0;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  const diff = nowMs - then;
  return diff <= 0 ? 0 : Math.floor(diff / (24 * 60 * 60 * 1000));
}

export function rowToOrphan(row: SessionStateRow, nowMs: number): OrphanEntry {
  return {
    id: row.id,
    artifact_type: row.artifact_type,
    title: row.title,
    status: row.status,
    session_id: row.session_id,
    created_at: row.created_at,
    last_touched_at: row.last_touched_at,
    age_days: ageDays(row.last_touched_at, nowMs),
  };
}

/**
 * Predicate for an orphan candidate. Something is orphaned when it is a
 * task/event that is still live (active), unpinned, not finished, and has sat
 * untouched past the cutoff. Plans and pinned rows are NEVER orphans — they are
 * deliberately protected from GC.
 */
function isOrphan(row: SessionStateRow, cutoffIso: string): boolean {
  if (!ORPHAN_ARTIFACTS.includes(row.artifact_type as (typeof ORPHAN_ARTIFACTS)[number])) return false;
  if (row.pinned) return false;
  if (!row.active) return false;
  if (row.status === 'done') return false;
  // Compaction summary events ('[compacted N events]', status='compacted') are
  // derived snapshots, not forgotten intentions — never nudge/GC them.
  if (row.status === 'compacted') return false;
  // last_touched_at strictly older than the cutoff.
  return !!row.last_touched_at && row.last_touched_at < cutoffIso;
}

/**
 * Shared orphan finder — used by both state_prune and the resume nudge.
 *
 * Returns the live, unpinned, unfinished task/event rows for a project whose
 * last_touched_at is older than `olderThanDays`, newest-touched first. Read-only.
 */
export async function findOrphans(
  storage: IStorage,
  projectId: string,
  olderThanDays: number,
  nowMs: number = Date.now(),
): Promise<SessionStateRow[]> {
  const cutoffIso = new Date(nowMs - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const rowGroups = await Promise.all(
    ORPHAN_ARTIFACTS.map((artifact_type) =>
      // Filter active=true at the storage layer; the rest of the predicate is applied in-memory.
      storage.listSessionState({ project_id: projectId, artifact_type, active: true }),
    ),
  );

  const orphans = rowGroups.flat().filter((row) => isOrphan(row, cutoffIso));
  // Newest-touched first — the most recently-forgotten surface at the top.
  return orphans.sort((a, b) => (a.last_touched_at < b.last_touched_at ? 1 : a.last_touched_at > b.last_touched_at ? -1 : 0));
}

/**
 * state_prune handler.
 *
 * Anti-orphaning GC. Finds working-state intentions (tasks + events) that
 * nobody has touched in `older_than_days` and are still live, unpinned, and
 * unfinished — the classic "created to do later, then forgotten" garbage.
 *
 * - mode 'surface' (default): reports the orphans WITHOUT modifying anything, so
 *   the user is nudged about forgotten work.
 * - mode 'evict': soft-evicts each orphan (active=false) so it drops out of the
 *   working ledger, and reports what was evicted. NEVER touches pinned rows or
 *   plan rows (they are excluded from the candidate set entirely).
 */
export async function handleStatePrune(
  storage: IStorage,
  projectId: string,
  olderThanDays?: number,
  mode?: 'surface' | 'evict',
): Promise<StatePruneResult> {
  const nowMs = Date.now();
  const resolvedDays =
    olderThanDays !== undefined && Number.isFinite(olderThanDays) && olderThanDays > 0
      ? Math.floor(olderThanDays)
      : DEFAULT_OLDER_THAN_DAYS;
  const resolvedMode: 'surface' | 'evict' = mode === 'evict' ? 'evict' : 'surface';
  const cutoffIso = new Date(nowMs - resolvedDays * 24 * 60 * 60 * 1000).toISOString();

  const orphanRows = await findOrphans(storage, projectId, resolvedDays, nowMs);

  if (resolvedMode === 'surface') {
    const orphaned = orphanRows.map((r) => rowToOrphan(r, nowMs));
    log('state_prune: surfaced', orphaned.length, 'orphans (>', resolvedDays, 'days) in', projectId);
    return {
      project_id: projectId,
      mode: 'surface',
      older_than_days: resolvedDays,
      cutoff: cutoffIso,
      orphaned,
      evicted_count: 0,
      message:
        orphaned.length === 0
          ? `No orphans — nothing untouched for more than ${resolvedDays} days.`
          : `${orphaned.length} orphaned intention(s) untouched for >${resolvedDays} days. You meant to do these but forgot. Re-touch (update status) to keep, or run state_prune with mode='evict' to clear them.`,
    };
  }

  // --- evict mode: soft-evict each orphan (active=false) ---
  const now = new Date(nowMs).toISOString();
  const evicted: OrphanEntry[] = [];
  for (const row of orphanRows) {
    await storage.updateSessionState(row.id, { active: false, updated_at: now });
    evicted.push(rowToOrphan(row, nowMs));
  }

  log('state_prune: evicted', evicted.length, 'orphans (>', resolvedDays, 'days) in', projectId);

  return {
    project_id: projectId,
    mode: 'evict',
    older_than_days: resolvedDays,
    cutoff: cutoffIso,
    orphaned: evicted,
    evicted_count: evicted.length,
    message:
      evicted.length === 0
        ? `Nothing to evict — no orphans untouched for more than ${resolvedDays} days.`
        : `Soft-evicted ${evicted.length} orphaned intention(s) (active=false). They are out of the working ledger but still stored; nothing pinned or plan-related was touched.`,
  };
}
