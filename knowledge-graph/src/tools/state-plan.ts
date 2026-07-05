import { randomUUID } from 'crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { IStorage } from '../storage/interface.js';
import { SessionStateRow, log } from '../types.js';

// === Result types ===

export interface StateSavePlanResult {
  id: string;
  clone_path: string;
  version: number;
  title: string;
  superseded_id: string | null;
}

export interface StatePlanEntry {
  id: string;
  title: string;
  version: number;
  status: string;
  source_path: string | null;
  clone_path: string | null;
  refs: string[];
  created_at: string;
}

export interface StateGetPlanResult {
  session_id: string | null;
  title: string | null;
  requested_version: number | null;
  plan: StatePlanEntry | null;
  versions: StatePlanEntry[];
  total: number;
}

const ARTIFACT_TYPE = 'plan';

/** Convert a title/filename into a filesystem-safe slug. */
function toSlug(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'plan';
}

/** Parse the JSON body of a plan row (tolerant of malformed bodies). */
function parsePlanBody(body: string): { source_path: string | null; clone_path: string | null; version: number | null } {
  if (!body) return { source_path: null, clone_path: null, version: null };
  try {
    const parsed = JSON.parse(body) as { source_path?: string | null; clone_path?: string | null; version?: number | null };
    return {
      source_path: parsed.source_path ?? null,
      clone_path: parsed.clone_path ?? null,
      version: parsed.version ?? null,
    };
  } catch {
    return { source_path: null, clone_path: null, version: null };
  }
}

/** Map a stored SessionStateRow (artifact_type=plan) to a read-back entry. */
function rowToEntry(row: SessionStateRow): StatePlanEntry {
  const { source_path, clone_path } = parsePlanBody(row.body);
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    status: row.status,
    source_path,
    clone_path,
    refs: row.refs ?? [],
    created_at: row.created_at,
  };
}

/**
 * state_save_plan handler.
 *
 * Clones a plan .md file into local state storage — immutable and versioned.
 * Version 1 is the "original plan". Each save creates a new immutable clone +
 * SessionState row; the previous active plan with the same title is marked
 * 'superseded' (its row and file are preserved for the version history).
 *
 * Clone path layout:
 *   <kgDir>/state/plans/<project_id>/<session_id>/<timestamp>-<slug>.md
 */
export async function handleStateSavePlan(
  storage: IStorage,
  kgDir: string,
  sessionId: string,
  projectId: string,
  sourcePath: string,
  title?: string,
  ts?: string,
): Promise<StateSavePlanResult> {
  if (!sourcePath || !sourcePath.trim()) {
    throw new Error('state_save_plan requires a source_path (the .md plan file to clone).');
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`state_save_plan: source file does not exist: ${sourcePath}`);
  }

  // Read the source file bytes (immutable snapshot — the clone never tracks later edits).
  const bytes = readFileSync(sourcePath);

  // Resolve title: explicit title wins, otherwise derive from the source filename.
  const fileBase = basename(sourcePath, extname(sourcePath));
  const resolvedTitle = (title?.trim() || fileBase).trim();
  const slug = toSlug(title?.trim() || fileBase);

  // Determine version = (# existing plan rows with same title in this project) + 1.
  const existingRows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: ARTIFACT_TYPE,
  });
  const sameTitle = existingRows.filter((r) => r.title === resolvedTitle);
  const version = sameTitle.length + 1;

  // Timestamp for the immutable filename (caller-supplied ts wins for determinism).
  const now = new Date().toISOString();
  const stamp = (ts?.trim() || now).replace(/[:.]/g, '-');

  // Clone the bytes into the state folder (mkdir -p).
  const cloneDir = join(kgDir, 'state', 'plans', projectId, sessionId);
  mkdirSync(cloneDir, { recursive: true });
  const clonePath = join(cloneDir, `${stamp}-${slug}.md`);
  writeFileSync(clonePath, bytes);

  // Supersede the previous active plan (same title) — keep the row + file.
  let supersededId: string | null = null;
  const prevActive = sameTitle.find((r) => r.active && r.status === 'active');
  if (prevActive) {
    await storage.updateSessionState(prevActive.id, {
      status: 'superseded',
      active: false,
      updated_at: now,
      last_touched_at: now,
    });
    supersededId = prevActive.id;
  }

  // Create the new plan row (immutable snapshot metadata).
  const id = randomUUID();
  await storage.createSessionState({
    id,
    session_id: sessionId,
    project_id: projectId,
    artifact_type: ARTIFACT_TYPE,
    status: 'active',
    title: resolvedTitle,
    body: JSON.stringify({ source_path: sourcePath, clone_path: clonePath, version }),
    refs: [clonePath, sourcePath],
    version,
    pinned: true,
    active: true,
    created_at: now,
    updated_at: now,
    last_touched_at: now,
  });

  log('state_save_plan: cloned plan', resolvedTitle, 'v' + version, '->', clonePath, supersededId ? `(superseded ${supersededId})` : '');

  return {
    id,
    clone_path: clonePath,
    version,
    title: resolvedTitle,
    superseded_id: supersededId,
  };
}

/**
 * state_get_plan handler.
 *
 * Returns the active (latest) plan by default, or a specific version.
 * version=1 returns the original plan. When title is omitted and multiple
 * plans exist, resolves the most recently created active plan.
 *
 * PROJECT-SCOPED by default (like state_resume): plans are project-level
 * artifacts — save_plan computes versions and supersession project-wide with no
 * session filter — so a fresh session (next day / new chat) can read back "the
 * original plan" and "the current plan" without owning any plan rows itself.
 * An explicit non-empty session_id narrows to that session's plans; an explicit
 * empty string is also project-wide.
 */
export async function handleStateGetPlan(
  storage: IStorage,
  projectId: string,
  callerSessionId: string,
  title?: string,
  version?: number,
  requestedSessionId?: string,
): Promise<StateGetPlanResult> {
  // Session scope: a specific non-empty session_id narrows to that session;
  // otherwise (undefined, empty string, or the caller's own auto-injected id)
  // the read spans ALL sessions of the project so cross-session catch-up works.
  const narrowSession =
    requestedSessionId !== undefined &&
    requestedSessionId !== '' &&
    requestedSessionId !== callerSessionId
      ? requestedSessionId
      : null;
  const scopeAllSessions = narrowSession === null;

  const rows = await storage.listSessionState({
    project_id: projectId,
    artifact_type: ARTIFACT_TYPE,
    ...(scopeAllSessions ? {} : { session_id: narrowSession }),
  });

  // Narrow to the requested title when provided.
  const normalizedTitle = title?.trim();
  let scoped = normalizedTitle ? rows.filter((r) => r.title === normalizedTitle) : rows;

  if (scoped.length === 0) {
    return {
      session_id: scopeAllSessions ? null : narrowSession,
      title: normalizedTitle ?? null,
      requested_version: version ?? null,
      plan: null,
      versions: [],
      total: 0,
    };
  }

  // If no title was given but multiple titles exist, focus on the most recently
  // created plan's title so version selection is unambiguous.
  if (!normalizedTitle) {
    const newest = [...scoped].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0];
    scoped = scoped.filter((r) => r.title === newest.title);
  }

  // All versions for this title, ascending by version (v1 = original first).
  const versions = [...scoped].sort((a, b) => a.version - b.version).map(rowToEntry);

  let selected: StatePlanEntry | null;
  if (version !== undefined) {
    selected = versions.find((v) => v.version === version) ?? null;
  } else {
    // Default: the active plan, falling back to the highest version.
    const active = scoped.find((r) => r.active && r.status === 'active');
    selected = active ? rowToEntry(active) : versions[versions.length - 1] ?? null;
  }

  return {
    session_id: scopeAllSessions ? null : narrowSession,
    title: versions[0]?.title ?? normalizedTitle ?? null,
    requested_version: version ?? null,
    plan: selected,
    versions,
    total: versions.length,
  };
}
