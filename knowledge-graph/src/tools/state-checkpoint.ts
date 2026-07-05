import { IStorage } from '../storage/interface.js';
import { SessionStateRow, StoredChunk, log } from '../types.js';
import { findOrphans, rowToOrphan, OrphanEntry } from './state-prune.js';

// === Result types ===

export interface ResumeContextEntry {
  id: string;
  focus: string;
  next_step: string | null;
  note: string | null;
  refs: string[];
  session_id: string;
  created_at: string;
}

export interface ResumeTaskEntry {
  id: string;
  title: string;
  status: string;
  blocked_by: string[];
  note: string | null;
  session_id: string;
  updated_at: string;
}

export interface ResumePlanEntry {
  id: string;
  title: string;
  version: number;
  clone_path: string | null;
  session_id: string;
  created_at: string;
}

export interface ResumeDecisionEntry {
  id: string;
  summary: string;
  domain: string;
  created_at: string;
}

/** Checkpoint packet — a fold of the current working state (session-scoped). */
export interface StateCheckpointResult {
  session_id: string;
  active_context: ResumeContextEntry[];
  open_tasks: ResumeTaskEntry[];
  active_plan: ResumePlanEntry | null;
  recent_decisions: ResumeDecisionEntry[];
}

/** Resume briefing — the project-scoped "catch me up" packet. */
export interface StateResumeResult {
  project_id: string;
  since_days: number | null;
  active_context: ResumeContextEntry[];
  open_tasks: ResumeTaskEntry[];
  active_plans: ResumePlanEntry[];
  recent_decisions: ResumeDecisionEntry[];
  /**
   * Anti-orphaning nudge — tasks/intentions untouched for > ORPHAN_AGE_DAYS,
   * not done, not pinned, still active. Kept SEPARATE from open_tasks so every
   * resume flags forgotten work without burying it in the normal task list.
   */
  orphaned: OrphanEntry[];
  markdown: string;
}

const CONTEXT_ARTIFACT = 'active_context';
const TASK_ARTIFACT = 'task';
const PLAN_ARTIFACT = 'plan';
const BLOCKED_BY_PREFIX = 'blocked_by:';

// Defaults for how much to fold in.
const DEFAULT_CONTEXT_LIMIT = 5;
const DEFAULT_DECISION_LIMIT = 10;

// Anti-orphaning nudge threshold — intentions untouched this long are surfaced
// as "forgotten" on every resume.
const ORPHAN_AGE_DAYS = 7;

// === Body / refs parsers (tolerant of malformed payloads) ===

function parseContextBody(body: string): { next_step: string | null; note: string | null } {
  if (!body) return { next_step: null, note: null };
  try {
    const parsed = JSON.parse(body) as { next_step?: string | null; note?: string | null };
    return { next_step: parsed.next_step ?? null, note: parsed.note ?? null };
  } catch {
    return { next_step: null, note: null };
  }
}

function parseTaskBody(body: string): { note: string | null } {
  if (!body) return { note: null };
  try {
    const parsed = JSON.parse(body) as { note?: string | null };
    return { note: parsed.note ?? null };
  } catch {
    return { note: null };
  }
}

function parsePlanBody(body: string): { clone_path: string | null; version: number | null } {
  if (!body) return { clone_path: null, version: null };
  try {
    const parsed = JSON.parse(body) as { clone_path?: string | null; version?: number | null };
    return { clone_path: parsed.clone_path ?? null, version: parsed.version ?? null };
  } catch {
    return { clone_path: null, version: null };
  }
}

function extractBlockedBy(refs: string[]): string[] {
  return (refs ?? [])
    .filter((r) => r.startsWith(BLOCKED_BY_PREFIX))
    .map((r) => r.slice(BLOCKED_BY_PREFIX.length));
}

// === Row -> entry mappers ===

function contextRowToEntry(row: SessionStateRow): ResumeContextEntry {
  const { next_step, note } = parseContextBody(row.body);
  return {
    id: row.id,
    focus: row.title,
    next_step,
    note,
    refs: row.refs ?? [],
    session_id: row.session_id,
    created_at: row.created_at,
  };
}

function taskRowToEntry(row: SessionStateRow): ResumeTaskEntry {
  const { note } = parseTaskBody(row.body);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    blocked_by: extractBlockedBy(row.refs),
    note,
    session_id: row.session_id,
    updated_at: row.updated_at,
  };
}

function planRowToEntry(row: SessionStateRow): ResumePlanEntry {
  const { clone_path } = parsePlanBody(row.body);
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    clone_path,
    session_id: row.session_id,
    created_at: row.created_at,
  };
}

function decisionChunkToEntry(chunk: StoredChunk): ResumeDecisionEntry {
  return {
    id: chunk.id,
    summary: chunk.summary,
    domain: chunk.domain,
    created_at: chunk.created_at,
  };
}

/** Newest-first by an ISO timestamp field (lexicographic == chronological for ISO-8601). */
function byNewest<T>(rows: T[], key: (r: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
}

/** Fetch recent decision chunks (category='decision'), newest first, capped. */
async function fetchRecentDecisions(storage: IStorage, limit: number): Promise<ResumeDecisionEntry[]> {
  const chunks = await storage.listChunks({ category: 'decision' }, limit);
  return byNewest(chunks, (c) => c.created_at)
    .slice(0, limit)
    .map(decisionChunkToEntry);
}

/**
 * state_checkpoint handler.
 *
 * Folds the CURRENT working state into a resume packet object (session-scoped):
 * the latest active_context rows, open (non-done) tasks, the active plan, and
 * recent decisions. Does not persist anything — it is a read-only snapshot fold.
 */
export async function handleStateCheckpoint(
  storage: IStorage,
  sessionId: string,
  projectId: string,
): Promise<StateCheckpointResult> {
  // active_context — prefer this session's rows; fall back to project-wide if the
  // session has written nothing yet (fresh session mid-flight).
  let contextRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: CONTEXT_ARTIFACT,
    active: true, // compacted/evicted rows excluded from the live stream
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  if (contextRows.length === 0 && sessionId) {
    contextRows = await storage.listSessionState({
      project_id: projectId,
      artifact_type: CONTEXT_ARTIFACT,
      active: true,
    });
  }
  const active_context = byNewest(contextRows, (r) => r.created_at)
    .slice(0, DEFAULT_CONTEXT_LIMIT)
    .map(contextRowToEntry);

  // open_tasks — all live tasks for the session, filtered to status != 'done'.
  const taskRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: TASK_ARTIFACT,
    active: true, // evicted orphans are out of the ledger
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  const open_tasks = byNewest(taskRows.filter((r) => r.status !== 'done'), (r) => r.updated_at)
    .map(taskRowToEntry);

  // active_plan — latest active plan row for the session (fall back to project-wide).
  let planRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: PLAN_ARTIFACT,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  if (planRows.length === 0 && sessionId) {
    planRows = await storage.listSessionState({
      project_id: projectId,
      artifact_type: PLAN_ARTIFACT,
    });
  }
  const activePlanRows = planRows.filter((r) => r.active && r.status === 'active');
  const activePlanRow = byNewest(activePlanRows.length > 0 ? activePlanRows : planRows, (r) => r.created_at)[0];
  const active_plan = activePlanRow ? planRowToEntry(activePlanRow) : null;

  // recent_decisions — durable Chunk-table decisions, newest first.
  const recent_decisions = await fetchRecentDecisions(storage, DEFAULT_DECISION_LIMIT);

  log('state_checkpoint: folded', active_context.length, 'context,', open_tasks.length, 'open tasks,', recent_decisions.length, 'decisions');

  return {
    session_id: sessionId,
    active_context,
    open_tasks,
    active_plan,
    recent_decisions,
  };
}

/** Render a resume packet as a compact human-readable markdown briefing. */
function formatResumeMarkdown(
  active_context: ResumeContextEntry[],
  open_tasks: ResumeTaskEntry[],
  active_plans: ResumePlanEntry[],
  recent_decisions: ResumeDecisionEntry[],
  orphaned: OrphanEntry[],
): string {
  const lines: string[] = [];
  lines.push('# Session Resume — what you were doing');

  // Active context — the single most actionable line is the latest focus.
  lines.push('');
  lines.push('## Active context');
  if (active_context.length === 0) {
    lines.push('_No recorded context yet._');
  } else {
    const latest = active_context[0];
    lines.push(`**Focus:** ${latest.focus}`);
    if (latest.next_step) lines.push(`**Next step:** ${latest.next_step}`);
    if (latest.refs.length > 0) lines.push(`**Refs:** ${latest.refs.join(', ')}`);
    if (active_context.length > 1) {
      lines.push('');
      lines.push('Recent trail:');
      for (const c of active_context.slice(1)) {
        lines.push(`- ${c.focus}`);
      }
    }
  }

  // Active plan(s).
  lines.push('');
  lines.push('## Active plan');
  if (active_plans.length === 0) {
    lines.push('_No active plan._');
  } else {
    for (const p of active_plans) {
      const path = p.clone_path ? ` — ${p.clone_path}` : '';
      lines.push(`- **${p.title}** (v${p.version})${path}`);
    }
  }

  // Open / blocked tasks.
  lines.push('');
  const blockedCount = open_tasks.filter((t) => t.status === 'blocked').length;
  lines.push(`## Open tasks (${open_tasks.length}${blockedCount > 0 ? `, ${blockedCount} blocked` : ''})`);
  if (open_tasks.length === 0) {
    lines.push('_No open tasks._');
  } else {
    for (const t of open_tasks) {
      const blocked = t.blocked_by.length > 0 ? ` [blocked_by: ${t.blocked_by.join(', ')}]` : '';
      lines.push(`- [${t.status}] ${t.title}${blocked}`);
    }
  }

  // Orphaned intentions — forgotten work nudge (kept visually distinct).
  lines.push('');
  lines.push(`## Orphaned — you meant to do these but forgot (${orphaned.length})`);
  if (orphaned.length === 0) {
    lines.push(`_Nothing untouched for more than ${ORPHAN_AGE_DAYS} days._`);
  } else {
    for (const o of orphaned) {
      lines.push(`- [${o.status}] ${o.title} (untouched ${o.age_days}d)`);
    }
  }

  // Recent decisions.
  lines.push('');
  lines.push(`## Recent decisions (${recent_decisions.length})`);
  if (recent_decisions.length === 0) {
    lines.push('_No decisions recorded._');
  } else {
    for (const d of recent_decisions) {
      lines.push(`- [${d.domain}] ${d.summary}`);
    }
  }

  return lines.join('\n');
}

/**
 * state_resume handler.
 *
 * PROJECT-SCOPED briefing — works on a brand-new session that has written
 * nothing yet, because it spans ALL sessions of the project. Returns the last
 * active context, all active plans, all non-done tasks, and recent decisions,
 * as a structured object plus a human-readable markdown string.
 */
export async function handleStateResume(
  storage: IStorage,
  projectId: string,
  sinceDays?: number,
): Promise<StateResumeResult> {
  // Optional time window — only surface state touched within the last N days.
  const sinceIso =
    sinceDays !== undefined && Number.isFinite(sinceDays) && sinceDays > 0
      ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  // active_context — across ALL sessions of the project, newest first (live only).
  const contextRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: CONTEXT_ARTIFACT,
    active: true,
  });
  const active_context = byNewest(contextRows, (r) => r.created_at)
    .filter((r) => (sinceIso ? r.created_at >= sinceIso : true))
    .slice(0, DEFAULT_CONTEXT_LIMIT)
    .map(contextRowToEntry);

  // open_tasks — all non-done live tasks across the project.
  const taskRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: TASK_ARTIFACT,
    active: true,
  });
  const open_tasks = byNewest(taskRows.filter((r) => r.status !== 'done'), (r) => r.updated_at)
    .map(taskRowToEntry);

  // active_plans — all currently-active plans across the project, newest first.
  const planRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: PLAN_ARTIFACT,
  });
  const active_plans = byNewest(planRows.filter((r) => r.active && r.status === 'active'), (r) => r.created_at)
    .map(planRowToEntry);

  // recent_decisions — durable Chunk-table decisions, newest first.
  const recent_decisions = await fetchRecentDecisions(storage, DEFAULT_DECISION_LIMIT);

  // orphaned — anti-orphaning nudge: tasks/intentions untouched for > ORPHAN_AGE_DAYS,
  // not done, not pinned, still active. Separate from open_tasks so it stands out.
  const nowMs = Date.now();
  const orphanRows = await findOrphans(storage, projectId, ORPHAN_AGE_DAYS, nowMs);
  const orphaned = orphanRows.map((r) => rowToOrphan(r, nowMs));

  const markdown = formatResumeMarkdown(active_context, open_tasks, active_plans, recent_decisions, orphaned);

  log('state_resume: project', projectId, '->', active_context.length, 'context,', open_tasks.length, 'open tasks,', active_plans.length, 'plans,', recent_decisions.length, 'decisions,', orphaned.length, 'orphaned');

  return {
    project_id: projectId,
    since_days: sinceDays ?? null,
    active_context,
    open_tasks,
    active_plans,
    recent_decisions,
    orphaned,
    markdown,
  };
}
