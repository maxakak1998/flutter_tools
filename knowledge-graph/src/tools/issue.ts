import { randomBytes } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Linker } from '../engine/linker.js';
import { ChunkMetadata, Importance, IssueStatus, IssuePriority, StoreResult, StepEmitter, StoredChunk, log } from '../types.js';
import { EntityAliasRegistry } from '../entity-registry.js';
import { handleStore } from './store.js';

/**
 * kg beads — issue tracker as first-class graph nodes.
 *
 * Issues are DURABLE Chunks (category 'issue') that ride the existing layer-based
 * git-sync path so a team sees them, just like decisions. Key design points:
 *  - dedup is bypassed (two bugs with similar titles = two issues).
 *  - status/priority/blocked_by live in dedicated Chunk columns synced via SyncChunkFile.
 *  - `issue_ref` is a short, human, SYNC-STABLE id. blocked_by holds issue_refs,
 *    NEVER the internal UUID `Chunk.id` (which is re-minted per machine on import).
 *  - ready-work is an in-memory join over listChunks (no graph traversal available).
 *
 * A large list cap is used everywhere issues are enumerated — the daemon default
 * of 50 would silently truncate a real 200+ issue tracker.
 */

/** Enumerate-all cap for issue queries — must exceed any realistic issue count. */
export const ISSUE_LIST_CAP = 10000;

const VALID_STATUS: IssueStatus[] = ['open', 'in_progress', 'blocked', 'closed'];
const VALID_PRIORITY: IssuePriority[] = ['p0', 'p1', 'p2', 'p3'];

/** Priority sort order (p0 first). */
const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3, '': 4 };

/**
 * Generate a short, human, sync-stable issue ref: `<prefix>-<base36(7)>`.
 * 36^7 ≈ 78 billion combinations — collisions are astronomically unlikely even
 * across machines that mint refs independently (addresses the multi-machine
 * collision concern), and a local listChunks scan double-checks within the daemon.
 */
function generateRef(prefix: string): string {
  // 5 random bytes → base36, padded/truncated to 7 chars.
  const n = parseInt(randomBytes(5).toString('hex'), 16);
  const s = n.toString(36).padStart(7, '0').slice(-7);
  return `${prefix}-${s}`;
}

/** Slugify a project name/id into a short ref prefix. */
function refPrefix(projectName: string | undefined): string {
  const base = (projectName ?? 'kg').toLowerCase().replace(/[^a-z0-9]/g, '');
  return base.slice(0, 6) || 'kg';
}

/** List every issue chunk (uncapped by the default-50 limit). */
async function listAllIssues(storage: IStorage): Promise<StoredChunk[]> {
  return storage.listChunks({ category: 'issue' }, ISSUE_LIST_CAP);
}

// ============================================================
// Auto-link — anchor a freshly written chunk to the session's current issue
// ============================================================

/**
 * If `issueRef` names a real issue, create a RELATES_TO edge from the new chunk
 * to that issue. Called by the daemon after a decision/knowledge/life chunk is
 * stored while the session has a current_issue anchor. No-ops silently if the
 * ref is empty or unknown (the chunk then surfaces via issue_orphans instead).
 * Returns the issue's chunk id if linked, else null.
 */
export async function autoLinkToIssue(
  storage: IStorage,
  newChunkId: string,
  issueRef: string | null,
): Promise<string | null> {
  if (!issueRef) return null;
  const issue = await findByRef(storage, issueRef);
  if (!issue) return null;
  if (issue.id === newChunkId) return null; // never self-link (e.g. issue_create itself)
  try {
    await storage.createRelation(newChunkId, issue.id, 'RELATES_TO', { auto_created: 'true' });
    log('auto-linked chunk', newChunkId, '→ issue', issueRef);
    return issue.id;
  } catch (e) {
    log('auto-link failed:', newChunkId, '→', issueRef, e);
    return null;
  }
}

// ============================================================
// issue_create
// ============================================================

export async function handleIssueCreate(
  storage: IStorage,
  embedder: Embedder,
  linker: Linker,
  args: {
    title: string;
    description?: string;
    priority?: IssuePriority;
    blocked_by?: string[];
    domain?: string;
    keywords?: string[];
  },
  projectName: string | undefined,
  onStep?: StepEmitter,
  dedupThreshold = 0.88,
): Promise<StoreResult & { issue_ref: string }> {
  const priority = args.priority && VALID_PRIORITY.includes(args.priority) ? args.priority : 'p2';

  // Mint a collision-free ref (checked against existing issues under the daemon mutex).
  const existing = await listAllIssues(storage);
  const usedRefs = new Set(existing.map(c => c.issue_ref).filter(Boolean));
  const prefix = refPrefix(projectName);
  let ref = generateRef(prefix);
  for (let i = 0; i < 10 && usedRefs.has(ref); i++) ref = generateRef(prefix);
  if (usedRefs.has(ref)) throw new Error('Could not mint a unique issue_ref after 10 attempts');

  // Validate blocked_by refs exist (warn, do not block — a ref may sync in later).
  const warnings: string[] = [];
  const blockedBy = (args.blocked_by ?? []).filter(Boolean);
  for (const b of blockedBy) {
    if (!usedRefs.has(b)) warnings.push(`blocked_by ref "${b}" does not match any known issue yet`);
  }

  const metadata: ChunkMetadata = {
    summary: args.title.slice(0, 200),
    keywords: args.keywords?.length ? args.keywords : deriveKeywords(args.title),
    domain: args.domain ?? 'issues',
    category: 'issue',
    importance: priorityToImportance(priority),
  };

  const content = args.description?.trim()
    ? `${args.title}\n\n${args.description.trim()}`
    : args.title;

  const result = await handleStore(
    storage, embedder, linker, content, metadata, onStep,
    dedupThreshold, 0.3, undefined, undefined, undefined,
    true, // skipDedup
    { issue_ref: ref, issue_status: 'open', issue_priority: priority, blocked_by: blockedBy },
  );

  result.warnings.push(...warnings);
  log('Created issue:', ref, `(chunk ${result.id})`);
  return { ...result, issue_ref: ref };
}

// ============================================================
// issue_update — status / priority / blocked_by, with optimistic CAS
// ============================================================

export async function handleIssueUpdate(
  storage: IStorage,
  args: {
    issue_ref: string;
    status?: IssueStatus;
    priority?: IssuePriority;
    blocked_by?: string[];
    expected_version?: number;
  },
): Promise<{ issue_ref: string; status: string; priority: string; blocked_by: string[]; version: number }> {
  const issue = await findByRef(storage, args.issue_ref);
  if (!issue) throw new Error(`Issue not found: ${args.issue_ref}`);

  // Optimistic concurrency: reject if the caller's expected version is stale.
  if (args.expected_version !== undefined && args.expected_version !== issue.version) {
    throw new Error(`Version conflict for ${args.issue_ref}: expected ${args.expected_version}, current ${issue.version}. Re-read and retry.`);
  }

  if (args.status && !VALID_STATUS.includes(args.status)) throw new Error(`Invalid status: ${args.status}`);
  if (args.priority && !VALID_PRIORITY.includes(args.priority)) throw new Error(`Invalid priority: ${args.priority}`);

  const nextStatus = args.status ?? (issue.issue_status as IssueStatus);
  const nextPriority = args.priority ?? (issue.issue_priority as IssuePriority);
  const nextBlockedBy = args.blocked_by !== undefined ? args.blocked_by.filter(Boolean) : issue.blocked_by;

  await storage.updateChunk(issue.id, {
    issue_status: nextStatus,
    issue_priority: nextPriority,
    blocked_by: nextBlockedBy,
    importance: priorityToImportance(nextPriority),
    version: issue.version + 1,
  });

  log('Updated issue:', args.issue_ref, `status=${nextStatus} priority=${nextPriority}`);
  return { issue_ref: args.issue_ref, status: nextStatus, priority: nextPriority, blocked_by: nextBlockedBy, version: issue.version + 1 };
}

// ============================================================
// issue_close — dedicated close action (strong semantic verb, split from update)
// ============================================================

/**
 * Close an issue. A distinct tool from issue_update because "close" is a
 * high-frequency, strong-semantic action — the AI should reach for `issue_close`
 * to finish work, not remember to pass status:'closed' to a generic updater.
 * Closing HIDES the issue from default lists but PRESERVES its whole linked graph.
 * Idempotent: closing an already-closed issue is a no-op success.
 */
export async function handleIssueClose(
  storage: IStorage,
  args: { issue_ref: string; expected_version?: number },
): Promise<{ issue_ref: string; status: string; version: number; already_closed: boolean }> {
  const issue = await findByRef(storage, args.issue_ref);
  if (!issue) throw new Error(`Issue not found: ${args.issue_ref}`);

  if (issue.issue_status === 'closed') {
    return { issue_ref: args.issue_ref, status: 'closed', version: issue.version, already_closed: true };
  }

  const updated = await handleIssueUpdate(storage, {
    issue_ref: args.issue_ref,
    status: 'closed',
    expected_version: args.expected_version,
  });
  log('Closed issue:', args.issue_ref);
  return { issue_ref: args.issue_ref, status: updated.status, version: updated.version, already_closed: false };
}

// ============================================================
// issue_list — filter by status/priority, hide closed by default
// ============================================================

export async function handleIssueList(
  storage: IStorage,
  args: { status?: IssueStatus; priority?: IssuePriority; include_closed?: boolean } = {},
): Promise<Array<{ issue_ref: string; title: string; status: string; priority: string; blocked_by: string[]; version: number; updated_at: string }>> {
  let issues = await listAllIssues(storage);

  if (args.status) issues = issues.filter(i => i.issue_status === args.status);
  else if (!args.include_closed) issues = issues.filter(i => i.issue_status !== 'closed');

  if (args.priority) issues = issues.filter(i => i.issue_priority === args.priority);

  issues.sort((a, b) => (PRIORITY_ORDER[a.issue_priority] ?? 4) - (PRIORITY_ORDER[b.issue_priority] ?? 4));

  return issues.map(toIssueSummary);
}

// ============================================================
// issue_show — one issue + its linked neighborhood
// ============================================================

export async function handleIssueShow(
  storage: IStorage,
  args: { issue_ref: string },
): Promise<{
  issue: ReturnType<typeof toIssueSummary> & { content: string };
  linked: Array<{ id: string; category: string; summary: string }>;
  attachments: Array<{ sha256: string; caption: string; rel_path: string; filename?: string }>;
}> {
  const issue = await findByRef(storage, args.issue_ref);
  if (!issue) throw new Error(`Issue not found: ${args.issue_ref}`);

  const neighbors = await storage.getRelatedChunks(issue.id, 1);
  const linked = neighbors
    .filter(n => n.id !== issue.id)
    .map(n => ({ id: n.id, category: n.category, summary: n.summary }));

  // Parse evidence-image linkage from the issue chunk's attachment_refs, joining
  // the bytes-index row for the real (ext-bearing) filename + rel_path. Bytes are
  // never embedded; this is a pure metadata read (like blocked_by).
  const attachments: Array<{ sha256: string; caption: string; rel_path: string; filename?: string }> = [];
  for (const ref of issue.attachment_refs ?? []) {
    const idx = ref.indexOf('|');
    const sha256 = idx === -1 ? ref : ref.slice(0, idx);
    const caption = idx === -1 ? '' : ref.slice(idx + 1);
    const row = await storage.getAttachment(sha256);
    const disk = row?.filename ? `${sha256}.${extOf(row.filename)}` : sha256;
    attachments.push({
      sha256,
      caption,
      rel_path: `.knowledge-graph/attachments/${disk}`,
      ...(row?.filename ? { filename: row.filename } : {}),
    });
  }

  return {
    issue: { ...toIssueSummary(issue), content: issue.content },
    linked,
    attachments,
  };
}

/** Extract a sanitized extension from an original filename (default png). */
function extOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  const ext = m ? m[1].toLowerCase() : '';
  return ext === 'jpeg' ? 'jpg' : (ext || 'png');
}

// ============================================================
// issue_ready — issues with no unresolved blockers (like `bd ready`)
// ============================================================

/**
 * Ready-work: open/in_progress issues whose every blocked_by ref resolves to a
 * CLOSED issue (or an unknown ref, treated as not-blocking). Pure in-memory join
 * over listChunks keyed on issue_ref — sync-stable, no graph traversal needed,
 * and uncapped by the default-50 list limit so a 200+ tracker works.
 */
export async function handleIssueReady(
  storage: IStorage,
  args: { priority?: IssuePriority } = {},
): Promise<Array<{ issue_ref: string; title: string; status: string; priority: string; blocked_by: string[]; version: number; updated_at: string }>> {
  const all = await listAllIssues(storage);

  // Map ref → status for O(1) blocker resolution.
  const statusByRef = new Map<string, string>();
  for (const i of all) statusByRef.set(i.issue_ref, i.issue_status);

  const isBlocking = (ref: string): boolean => {
    const st = statusByRef.get(ref);
    // Unknown ref → not blocking (may sync in later; do not hide ready work on it).
    if (st === undefined) return false;
    return st !== 'closed';
  };

  let ready = all.filter(i =>
    (i.issue_status === 'open' || i.issue_status === 'in_progress') &&
    !(i.blocked_by ?? []).some(isBlocking)
  );

  if (args.priority) ready = ready.filter(i => i.issue_priority === args.priority);
  ready.sort((a, b) => (PRIORITY_ORDER[a.issue_priority] ?? 4) - (PRIORITY_ORDER[b.issue_priority] ?? 4));
  return ready.map(toIssueSummary);
}

// ============================================================
// issue_stale — open issues untouched for N days (anti-graveyard)
// ============================================================

/**
 * Read-only anti-graveyard report, symmetric to state_prune: open/in_progress
 * issues whose updated_at is older than `days` (default 14). Surfaces backlog
 * that nobody has returned to so it does not silently rot.
 */
export async function handleIssueStale(
  storage: IStorage,
  args: { days?: number; now?: string } = {},
): Promise<Array<{ issue_ref: string; title: string; status: string; priority: string; days_stale: number; updated_at: string }>> {
  const days = args.days ?? 14;
  const nowMs = args.now ? Date.parse(args.now) : Date.now();
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;

  const all = await listAllIssues(storage);
  const stale = all.filter(i =>
    (i.issue_status === 'open' || i.issue_status === 'in_progress') &&
    Date.parse(i.updated_at) < cutoffMs
  );

  stale.sort((a, b) => (Date.parse(a.updated_at) - Date.parse(b.updated_at))); // oldest first
  return stale.map(i => ({
    issue_ref: i.issue_ref,
    title: i.summary,
    status: i.issue_status,
    priority: i.issue_priority,
    days_stale: Math.floor((nowMs - Date.parse(i.updated_at)) / (24 * 60 * 60 * 1000)),
    updated_at: i.updated_at,
  }));
}

// ============================================================
// issue_link — manually link an issue to a chunk (decision/insight/knowledge)
// ============================================================

export async function handleIssueLink(
  storage: IStorage,
  args: { issue_ref: string; chunk_id: string; relation?: string },
): Promise<{ issue_ref: string; chunk_id: string; relation: string }> {
  const issue = await findByRef(storage, args.issue_ref);
  if (!issue) throw new Error(`Issue not found: ${args.issue_ref}`);
  const target = await storage.getChunk(args.chunk_id);
  if (!target) throw new Error(`Chunk not found: ${args.chunk_id}`);

  const relation = (args.relation ?? 'relates_to').toUpperCase();
  await storage.createRelation(args.chunk_id, issue.id, relation, { auto_created: 'false' });
  log('linked chunk', args.chunk_id, '→ issue', args.issue_ref, `(${relation})`);
  return { issue_ref: args.issue_ref, chunk_id: args.chunk_id, relation };
}

// ============================================================
// issue_orphans — chunks that look issue-worthy but link to no issue
// ============================================================

/**
 * Surface recent decision/insight chunks that have NO edge to any issue — the
 * chunk-side blind spot (a decision written while current_issue was unset).
 * issue_show is issue-centric and cannot see these. Read-only: the AI/user then
 * links them manually via issue_link.
 */
export async function handleIssueOrphans(
  storage: IStorage,
  args: { categories?: string[]; limit?: number; since?: string } = {},
): Promise<Array<{ id: string; category: string; summary: string; created_at: string }>> {
  const categories = args.categories ?? ['decision', 'insight'];
  const limit = args.limit ?? 20;

  // Build the set of issue chunk ids so we can tell if a neighbor is an issue.
  const issues = await listAllIssues(storage);
  const issueIds = new Set(issues.map(i => i.id));

  const orphans: Array<{ id: string; category: string; summary: string; created_at: string }> = [];
  for (const category of categories) {
    const chunks = await storage.listChunks({ category }, ISSUE_LIST_CAP);
    for (const c of chunks) {
      if (args.since && c.created_at < args.since) continue;
      const neighbors = await storage.getRelatedChunks(c.id, 1);
      const linksToIssue = neighbors.some(n => issueIds.has(n.id));
      if (!linksToIssue) {
        orphans.push({ id: c.id, category: c.category, summary: c.summary, created_at: c.created_at });
      }
    }
  }

  // Newest first, capped.
  orphans.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return orphans.slice(0, limit);
}

// ============================================================
// Helpers
// ============================================================

/** Find an issue chunk by its sync-stable ref. */
export async function findByRef(storage: IStorage, ref: string): Promise<StoredChunk | null> {
  const issues = await listAllIssues(storage);
  return issues.find(i => i.issue_ref === ref) ?? null;
}

function toIssueSummary(c: StoredChunk) {
  return {
    issue_ref: c.issue_ref,
    title: c.summary,
    status: c.issue_status,
    priority: c.issue_priority,
    blocked_by: c.blocked_by,
    version: c.version,
    updated_at: c.updated_at,
  };
}

/** Map issue priority → chunk importance (so existing ranking still applies). */
function priorityToImportance(priority: string): Importance {
  switch (priority) {
    case 'p0': return 'critical';
    case 'p1': return 'high';
    case 'p2': return 'medium';
    default: return 'low';
  }
}

/** Cheap keyword extraction from a title when none supplied (store requires >=1). */
function deriveKeywords(title: string): string[] {
  const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  const out = [...new Set(words)].slice(0, 6);
  return out.length ? out : ['issue'];
}
