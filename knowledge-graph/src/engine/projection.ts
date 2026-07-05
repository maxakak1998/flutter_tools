import { IStorage } from '../storage/interface.js';
import { SessionStateRow, log } from '../types.js';

// === Result types ===

/** One live session's current focus, folded from its latest active_context row. */
export interface ProjectionSessionFocus {
  session_id: string;
  focus: string;
  next_step: string | null;
  refs: string[];
  updated_at: string;
}

/** One open (non-done) task, attributed to the session that owns it. */
export interface ProjectionTask {
  id: string;
  title: string;
  status: string;
  blocked_by: string[];
  session_id: string;
  updated_at: string;
}

/**
 * The merged cross-session view: what every live session is working on right
 * now, the union of files being edited, and the combined open-task board.
 */
export interface ProjectionView {
  project_id: string;
  sessions: ProjectionSessionFocus[]; // per session_id, its latest focus
  edited_files: string[]; // UNION of active_context refs across sessions
  open_tasks: ProjectionTask[]; // combined open-task list across sessions
  generated_at: string;
}

/** state_projection result — the folded view plus a human-readable summary. */
export interface StateProjectionResult extends ProjectionView {
  markdown: string;
}

const CONTEXT_ARTIFACT = 'active_context';
const TASK_ARTIFACT = 'task';
const BLOCKED_BY_PREFIX = 'blocked_by:';

// === Body / refs parsers (tolerant of malformed payloads) ===

function parseContextBody(body: string): { next_step: string | null } {
  if (!body) return { next_step: null };
  try {
    const parsed = JSON.parse(body) as { next_step?: string | null };
    return { next_step: parsed.next_step ?? null };
  } catch {
    return { next_step: null };
  }
}

function extractBlockedBy(refs: string[]): string[] {
  return (refs ?? [])
    .filter((r) => r.startsWith(BLOCKED_BY_PREFIX))
    .map((r) => r.slice(BLOCKED_BY_PREFIX.length));
}

/** active_context refs are plain file/feature paths (no blocked_by prefix). */
function extractFileRefs(refs: string[]): string[] {
  return (refs ?? []).filter((r) => !r.startsWith(BLOCKED_BY_PREFIX));
}

/** Newest-first by an ISO timestamp field (lexicographic == chronological for ISO-8601). */
function byNewest<T>(rows: T[], key: (r: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
}

// ============================================================
// In-memory projection cache (keyed by projectId, invalidate-on-write)
// ============================================================

interface CacheEntry {
  view: ProjectionView;
  dirty: boolean;
}

const projectionCache = new Map<string, CacheEntry>();

/**
 * Mark a project's cached projection stale. Call after ANY SessionState write
 * (context/task/plan) so the next buildProjection recomputes from storage.
 */
export function invalidateProjection(projectId: string): void {
  const entry = projectionCache.get(projectId);
  if (entry) {
    entry.dirty = true;
    log('projection: invalidated cache for project', projectId);
  }
}

/**
 * Build the merged cross-session view for a project.
 *
 * Folds ALL sessions' latest active_context (one focus per session_id) plus the
 * union of edited-file refs and the combined open-task list. Served from an
 * in-memory cache; recomputed only when the cache is missing or marked dirty by
 * invalidateProjection().
 */
export async function buildProjection(storage: IStorage, projectId: string): Promise<ProjectionView> {
  const cached = projectionCache.get(projectId);
  if (cached && !cached.dirty) {
    return cached.view;
  }

  // active_context — across ALL sessions of the project (live rows only).
  const contextRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: CONTEXT_ARTIFACT,
    active: true,
  });

  // Fold to one latest focus per session_id.
  const latestBySession = new Map<string, SessionStateRow>();
  for (const row of contextRows) {
    const prev = latestBySession.get(row.session_id);
    if (!prev || row.created_at > prev.created_at) {
      latestBySession.set(row.session_id, row);
    }
  }

  const sessions: ProjectionSessionFocus[] = byNewest(
    Array.from(latestBySession.values()),
    (r) => r.created_at,
  ).map((r) => ({
    session_id: r.session_id,
    focus: r.title,
    next_step: parseContextBody(r.body).next_step,
    refs: extractFileRefs(r.refs),
    updated_at: r.created_at,
  }));

  // UNION of edited-file refs across all sessions' active_context rows.
  const fileSet = new Set<string>();
  for (const row of contextRows) {
    for (const ref of extractFileRefs(row.refs)) fileSet.add(ref);
  }
  const edited_files = Array.from(fileSet).sort();

  // open_tasks — all non-done tasks across the project, newest first (live only).
  const taskRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: TASK_ARTIFACT,
    active: true,
  });
  const open_tasks: ProjectionTask[] = byNewest(
    taskRows.filter((r) => r.status !== 'done'),
    (r) => r.updated_at,
  ).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    blocked_by: extractBlockedBy(r.refs),
    session_id: r.session_id,
    updated_at: r.updated_at,
  }));

  const view: ProjectionView = {
    project_id: projectId,
    sessions,
    edited_files,
    open_tasks,
    generated_at: new Date().toISOString(),
  };

  projectionCache.set(projectId, { view, dirty: false });
  log(
    'projection: built for project', projectId, '->',
    sessions.length, 'sessions,',
    edited_files.length, 'edited files,',
    open_tasks.length, 'open tasks',
  );

  return view;
}

/** Render the projection view as a compact cross-session focus/task board. */
function formatProjectionMarkdown(view: ProjectionView): string {
  const lines: string[] = [];
  lines.push('# Cross-session board — what every live session is working on');

  // Per-session focus.
  lines.push('');
  lines.push(`## Sessions (${view.sessions.length})`);
  if (view.sessions.length === 0) {
    lines.push('_No active session context recorded._');
  } else {
    for (const s of view.sessions) {
      lines.push(`- **${s.session_id}** — ${s.focus}`);
      if (s.next_step) lines.push(`  - next: ${s.next_step}`);
      if (s.refs.length > 0) lines.push(`  - refs: ${s.refs.join(', ')}`);
    }
  }

  // Union of edited files (a quick collision radar).
  lines.push('');
  lines.push(`## Edited files (${view.edited_files.length})`);
  if (view.edited_files.length === 0) {
    lines.push('_No files referenced yet._');
  } else {
    for (const f of view.edited_files) {
      lines.push(`- ${f}`);
    }
  }

  // Combined open-task board.
  lines.push('');
  const blockedCount = view.open_tasks.filter((t) => t.status === 'blocked').length;
  lines.push(`## Open tasks (${view.open_tasks.length}${blockedCount > 0 ? `, ${blockedCount} blocked` : ''})`);
  if (view.open_tasks.length === 0) {
    lines.push('_No open tasks._');
  } else {
    for (const t of view.open_tasks) {
      const blocked = t.blocked_by.length > 0 ? ` [blocked_by: ${t.blocked_by.join(', ')}]` : '';
      lines.push(`- [${t.status}] ${t.title} (${t.session_id})${blocked}`);
    }
  }

  return lines.join('\n');
}

/**
 * state_projection handler.
 *
 * Returns the merged cross-session view (per-session focus, union of edited
 * files, combined open tasks) plus a markdown summary of the board.
 */
export async function handleStateProjection(
  storage: IStorage,
  projectId: string,
): Promise<StateProjectionResult> {
  const view = await buildProjection(storage, projectId);
  const markdown = formatProjectionMarkdown(view);
  return { ...view, markdown };
}
