import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { SessionStateRow, log } from '../types.js';

// === Result types ===

export interface StateSetContextResult {
  id: string;
  session_id: string;
  focus: string;
  next_step: string | null;
  refs: string[];
  created_at: string;
}

export interface StateContextEntry {
  id: string;
  focus: string;
  next_step: string | null;
  note: string | null;
  refs: string[];
  created_at: string;
}

export interface StateGetContextResult {
  session_id: string | null;
  latest: StateContextEntry | null;
  trail: StateContextEntry[];
  total: number;
}

const ARTIFACT_TYPE = 'active_context';

/** Parse the JSON body of an active_context row into next_step + note (tolerant of malformed bodies). */
function parseContextBody(body: string): { next_step: string | null; note: string | null } {
  if (!body) return { next_step: null, note: null };
  try {
    const parsed = JSON.parse(body) as { next_step?: string | null; note?: string | null };
    return {
      next_step: parsed.next_step ?? null,
      note: parsed.note ?? null,
    };
  } catch {
    return { next_step: null, note: null };
  }
}

/** Map a stored SessionStateRow to a context entry for read-back. */
function rowToEntry(row: SessionStateRow): StateContextEntry {
  const { next_step, note } = parseContextBody(row.body);
  return {
    id: row.id,
    focus: row.title,
    next_step,
    note,
    refs: row.refs ?? [],
    created_at: row.created_at,
  };
}

/**
 * state_set_context handler.
 *
 * APPENDS a new active_context SessionState row on every call — never updates a
 * previous row — so the session keeps a full trail of what the AI worked on.
 */
export async function handleStateSetContext(
  storage: IStorage,
  sessionId: string,
  projectId: string,
  focus: string,
  nextStep?: string,
  refs?: string[],
  note?: string,
): Promise<StateSetContextResult> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const normalizedNextStep = nextStep?.trim() || null;
  const normalizedNote = note?.trim() || null;
  const normalizedRefs = refs ?? [];

  await storage.createSessionState({
    id,
    session_id: sessionId,
    project_id: projectId,
    artifact_type: ARTIFACT_TYPE,
    status: 'current',
    title: focus,
    body: JSON.stringify({ next_step: normalizedNextStep, note: normalizedNote }),
    refs: normalizedRefs,
    version: 1,
    pinned: false,
    active: true,
    created_at: now,
    updated_at: now,
    last_touched_at: now,
  });

  log('state_set_context: appended active_context row', id, 'session', sessionId);

  return {
    id,
    session_id: sessionId,
    focus,
    next_step: normalizedNextStep,
    refs: normalizedRefs,
    created_at: now,
  };
}

/**
 * state_get_context handler.
 *
 * Lists active_context rows for a session (defaults to the caller's session;
 * when session_id is explicitly empty/omitted, spans all sessions of the
 * project), newest first, and returns the latest focus plus a recent trail.
 */
export async function handleStateGetContext(
  storage: IStorage,
  callerSessionId: string,
  projectId: string,
  requestedSessionId?: string,
  limit = 10,
  since?: string,
): Promise<StateGetContextResult> {
  // Default to the caller's session; an explicit empty string means "all sessions".
  const targetSessionId = requestedSessionId !== undefined ? requestedSessionId : callerSessionId;
  const scopeAllSessions = targetSessionId === '';

  const rows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: ARTIFACT_TYPE,
    active: true, // compacted/evicted rows are out of the live stream
    ...(scopeAllSessions ? {} : { session_id: targetSessionId }),
  });

  // Newest first (created_at is ISO-8601 — lexicographic order matches chronological).
  let sorted = rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  if (since) {
    sorted = sorted.filter((r) => r.created_at >= since);
  }

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
  const trailRows = sorted.slice(0, safeLimit);
  const trail = trailRows.map(rowToEntry);

  return {
    session_id: scopeAllSessions ? null : targetSessionId,
    latest: trail.length > 0 ? trail[0] : null,
    trail,
    total: sorted.length,
  };
}
