import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { SessionStateRow, log } from '../types.js';

// === Result types ===

export interface StateTaskEntry {
  id: string;
  title: string;
  status: string;
  blocked_by: string[];
  note: string | null;
  session_id: string;
  created_at: string;
  updated_at: string;
}

export interface StateTaskListResult {
  session_id: string | null;
  status: string | null;
  tasks: StateTaskEntry[];
  total: number;
}

const ARTIFACT_TYPE = 'task';
const BLOCKED_BY_PREFIX = 'blocked_by:';

/** Parse the JSON body of a task row (tolerant of malformed bodies). */
function parseTaskBody(body: string): { note: string | null } {
  if (!body) return { note: null };
  try {
    const parsed = JSON.parse(body) as { note?: string | null };
    return { note: parsed.note ?? null };
  } catch {
    return { note: null };
  }
}

/** Extract the blocked_by task ids from a row's refs (drops the "blocked_by:" prefix). */
function extractBlockedBy(refs: string[]): string[] {
  return (refs ?? [])
    .filter((r) => r.startsWith(BLOCKED_BY_PREFIX))
    .map((r) => r.slice(BLOCKED_BY_PREFIX.length));
}

/** Encode blocked_by task ids into prefixed refs. */
function encodeBlockedBy(blockedBy: string[]): string[] {
  return [...new Set(blockedBy)]
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((b) => `${BLOCKED_BY_PREFIX}${b}`);
}

/** Map a stored SessionStateRow (artifact_type=task) to a read-back entry. */
function rowToEntry(row: SessionStateRow): StateTaskEntry {
  const { note } = parseTaskBody(row.body);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    blocked_by: extractBlockedBy(row.refs),
    note,
    session_id: row.session_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * state_task_upsert handler.
 *
 * Creates a new task (task_id omitted) or updates an existing one in place.
 *
 * Create: mints a new SessionState row (artifact_type='task') carrying the
 * title, status, note (in the JSON body), and blocked_by ids (in refs, prefixed
 * "blocked_by:<id>"), version=1, active=true.
 *
 * Update: patches the existing row in place via a cheap SET — status,
 * blocked_by, note, updated_at, last_touched_at. Only provided fields change;
 * title updates too when supplied.
 */
export async function handleStateTaskUpsert(
  storage: IStorage,
  sessionId: string,
  projectId: string,
  title: string,
  status: string,
  taskId?: string,
  blockedBy?: string[],
  note?: string,
): Promise<StateTaskEntry> {
  const now = new Date().toISOString();

  // --- Update path: task_id provided ---
  if (taskId) {
    const existing = await storage.getSessionState(taskId);
    if (!existing || existing.artifact_type !== ARTIFACT_TYPE) {
      throw new Error(`state_task_upsert: task not found: ${taskId}`);
    }

    // Merge note: new note wins, otherwise preserve the existing body's note.
    const prevNote = parseTaskBody(existing.body).note;
    const resolvedNote = note !== undefined ? note : prevNote;

    const updates: Partial<SessionStateRow> = {
      status,
      body: JSON.stringify({ note: resolvedNote }),
      updated_at: now,
      last_touched_at: now,
    };
    // Title is optional to change on update — only overwrite when a non-empty title is given.
    if (title !== undefined && title.trim().length > 0) {
      updates.title = title;
    }
    // blocked_by only overwrites when explicitly provided.
    if (blockedBy !== undefined) {
      updates.refs = encodeBlockedBy(blockedBy);
    }

    await storage.updateSessionState(taskId, updates);
    log('state_task_upsert: updated task', taskId, '->', status);

    const updated = await storage.getSessionState(taskId);
    return rowToEntry(updated ?? { ...existing, ...updates } as SessionStateRow);
  }

  // --- Create path: mint a new task row ---
  if (!title || !title.trim()) {
    throw new Error('state_task_upsert requires a title when creating a task.');
  }

  const id = randomUUID();
  const refs = encodeBlockedBy(blockedBy ?? []);
  await storage.createSessionState({
    id,
    session_id: sessionId,
    project_id: projectId,
    artifact_type: ARTIFACT_TYPE,
    status,
    title,
    body: JSON.stringify({ note: note ?? null }),
    refs,
    version: 1,
    pinned: false,
    active: true,
    created_at: now,
    updated_at: now,
    last_touched_at: now,
  });

  log('state_task_upsert: created task', id, '(', status, ')', title);

  const created = await storage.getSessionState(id);
  return created
    ? rowToEntry(created)
    : {
        id,
        title,
        status,
        blocked_by: extractBlockedBy(refs),
        note: note ?? null,
        session_id: sessionId,
        created_at: now,
        updated_at: now,
      };
}

/**
 * state_task_list handler.
 *
 * Lists task rows for the project, optionally scoped to a session and/or a
 * status. Answers "what is the current status?" — what is done, in progress,
 * blocked, or pending.
 */
export async function handleStateTaskList(
  storage: IStorage,
  projectId: string,
  sessionId?: string,
  status?: string,
): Promise<StateTaskListResult> {
  const rows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: ARTIFACT_TYPE,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(status ? { status } : {}),
  });

  const tasks = rows.map(rowToEntry);

  return {
    session_id: sessionId ?? null,
    status: status ?? null,
    tasks,
    total: tasks.length,
  };
}
