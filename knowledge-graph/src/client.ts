/**
 * MCP client — thin stdio-to-HTTP proxy.
 * Speaks MCP protocol to Claude Code via stdio, forwards tool calls to daemon via HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { makeRpcRequest } from './rpc.js';
import { log } from './types.js';
import { getRuntimeVersion } from './version.js';
import { ensureDaemon } from './daemon-manager.js';
import type { ProjectInfo } from './project.js';
import type { KnowledgeConfig } from './config.js';

// ============================================================
// RPC call to daemon
// ============================================================

/**
 * Marker error for a failed HTTP hop to the daemon (daemon dead / port closed /
 * connection refused). Distinct from a well-formed JSON-RPC error, which is a
 * real caller-side failure (e.g. validation) and must NOT trigger a daemon revive.
 */
export class DaemonUnreachableError extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'DaemonUnreachableError';
  }
}

export async function rpcCall(daemonUrl: string, method: string, params: unknown): Promise<unknown> {
  const req = makeRpcRequest(method, params);
  let res: Response;
  try {
    res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (e) {
    // fetch() rejects (ECONNREFUSED / "fetch failed") only when the transport
    // itself failed — the daemon is unreachable. Surface as a revive signal.
    throw new DaemonUnreachableError(e);
  }
  const json = await res.json() as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

/**
 * Single self-heal retry around an RPC. If `call` throws DaemonUnreachableError,
 * run `revive` once and retry; anything else (a real JSON-RPC error) propagates
 * immediately. Extracted as a pure, injectable function so it is testable without
 * a live stdio transport.
 */
export async function callWithRevive(
  call: () => Promise<unknown>,
  revive: () => Promise<void>,
): Promise<unknown> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof DaemonUnreachableError)) throw e;
    await revive();
    return call();
  }
}

// ============================================================
// Unified response envelope
// ============================================================
//
// Every tool response is wrapped at the proxyTool chokepoint so the MCP consumer
// (Claude) reads ONE shape and can classify failures without string-matching:
//   success → { ok: true,  data }
//   error   → { ok: false, error: { code, message, retryable, hint } }
//
// The envelope lives ONLY inside the MCP `text` content — the daemon `/rpc`
// contract and all 27 handlers are untouched. Do NOT register an outputSchema
// for these tools: an outputSchema forces `structuredContent` onto every success
// path and would break the text-only envelope.
//
// IMPORTANT boundary: Zod validates tool params BEFORE this callback runs, so a
// bad-type argument produces an SDK error that never reaches wrapError — its text
// will NOT parse as `{ok:false}`. Consumers must treat an `isError:true` whose
// text is not a `{ok:...}` envelope as a validation failure (fix the params).

export type ErrorCode =
  | 'daemon_unreachable'
  | 'version_conflict'
  | 'ollama_failed'
  | 'not_found'
  | 'validation'
  | 'internal';

export interface EnvelopeError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  hint: string;
}

const HINTS: Record<ErrorCode, string> = {
  daemon_unreachable:
    'Daemon was unreachable; auto-restart already retried once. Try the call again.',
  version_conflict:
    'Re-read (issue_show/issue_list) for the current version, then retry.',
  ollama_failed: 'Embedding backend (Ollama) failed; retry shortly.',
  not_found:
    'Target id/ref does not exist — check with issue_list/knowledge_list.',
  validation:
    'Caller-fixable: fix the arguments/preconditions and call again.',
  internal: 'Unexpected internal error; do not blindly retry.',
};

const RETRYABLE: Record<ErrorCode, boolean> = {
  daemon_unreachable: true,
  version_conflict: true,
  ollama_failed: true,
  not_found: false,
  validation: false,
  internal: false,
};

/**
 * Classify a thrown error into a stable code + retryable + hint.
 *
 * ORDER MATTERS — the first matching branch wins. Two ordering rules were found
 * by adversarial review against the REAL handler messages:
 *  - ollama MUST be checked before not_found: embedder throws
 *    "Model bge-m3 not found. Run: ollama pull" which would otherwise be
 *    mis-tagged not_found (no-retry) instead of ollama_failed (retryable).
 *  - the validation regex uses `require` (matches require/requires/required) plus
 *    the precondition verbs handlers actually emit (Cannot promote/delete/link,
 *    "does not exist" is claimed by not_found, "across layers", "not an
 *    operational"), because the old `/required/` missed ~10 caller-fixable errors.
 */
export function classifyError(e: unknown): EnvelopeError {
  const message = e instanceof Error ? e.message : String(e);
  const code = classifyCode(e, message);
  return { code, message, retryable: RETRYABLE[code], hint: HINTS[code] };
}

function classifyCode(e: unknown, message: string): ErrorCode {
  if (e instanceof DaemonUnreachableError) return 'daemon_unreachable';
  if (/version conflict/i.test(message)) return 'version_conflict';
  if (/ollama|embed|ollama pull|model .* not found/i.test(message)) return 'ollama_failed';
  // Attachment source errors are caller-fixable (bad path / oversize file), not
  // missing graph targets — classify validation even though "invalid source:
  // <path> (not found)" carries the "not found" substring the next branch claims.
  if (/invalid source|too large|exceeds/i.test(message)) return 'validation';
  if (/not found|does not exist/i.test(message)) return 'not_found';
  if (/invalid|must be|require|needs?|not enough|already|too_big|too large|exceeds|cannot (promote|delete|link|record)|without a reason|not an operational|across layers/i.test(message)) return 'validation';
  return 'internal';
}

/** Wrap a successful tool result. Coalesces undefined → null so ok:true ALWAYS carries a `data` key. */
export function wrapSuccess(data: unknown): { ok: true; data: unknown } {
  return { ok: true, data: data ?? null };
}

/** Wrap a thrown error into the failure envelope. */
export function wrapError(e: unknown): { ok: false; error: EnvelopeError } {
  return { ok: false, error: classifyError(e) };
}

// ============================================================
// Tool schemas (Zod validation before forwarding to daemon)
// ============================================================

const categoryEnum = z.enum(['fact', 'rule', 'insight', 'question', 'workflow', 'decision', 'issue']);
const issueStatusEnum = z.enum(['open', 'in_progress', 'blocked', 'closed']);
const issuePriorityEnum = z.enum(['p0', 'p1', 'p2', 'p3']);
const importanceEnum = z.enum(['critical', 'high', 'medium', 'low']);
const lifecycleEnum = z.enum(['hypothesis', 'validated', 'promoted', 'canonical', 'refuted', 'active']);
const relationEnum = z.enum(['relates_to', 'depends_on', 'contradicts', 'supersedes', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes', 'transitions_to', 'governed_by']);
const suggestedRelationEnum = z.enum(['relates_to', 'depends_on', 'contradicts', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes', 'transitions_to', 'governed_by']);

const entitySchema = z.union([
  z.string().min(2),
  z.object({ name: z.string().min(2), alias: z.string().min(1).optional() }),
]);

const storeRelationSchema = z.object({
  from_entity: z.string().min(2),
  to_entity: z.string().min(2),
  relation: suggestedRelationEnum,
});

const metadataSchema = z.object({
  summary: z.string().min(1).max(200),
  keywords: z.array(z.string().min(2)).min(1).max(15),
  domain: z.string().max(50),
  category: categoryEnum,
  importance: importanceEnum,
  layer: z.string().optional(),
  entities: z.array(entitySchema).max(4).optional(),
  relations: z.array(storeRelationSchema).max(4).optional(),
  suggested_relations: z.array(z.object({
    concept: z.string(),
    relation: suggestedRelationEnum,
  })).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
});

// ============================================================
// Client main
// ============================================================

export async function clientMain(
  initialDaemonUrl: string,
  project: ProjectInfo,
  config: KnowledgeConfig,
): Promise<void> {
  const projectId = project.projectId;
  // Mutable so a self-heal can repoint every subsequent RPC at a freshly
  // respawned daemon (new port) without restarting the client.
  let daemonUrl = initialDaemonUrl;

  // Mint a stable per-process session id. A client restart = new session id
  // (documented tradeoff — session identity is per-process, not persisted).
  const sessionId = randomUUID();

  // Register (or re-register) this session with the daemon. Called at startup and
  // again after every revive — without re-connecting, the freshly respawned daemon
  // would count clients=0 and idle-shut-down in ~5min even while we're working.
  async function connectSession(): Promise<void> {
    await fetch(`${daemonUrl}/rpc/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {});
  }

  // Respawn/rediscover the daemon and re-register. ensureDaemon() already handles
  // health-check → cleanup stale files → fork a new daemon, returning a live URL.
  async function reviveDaemon(): Promise<void> {
    log('Daemon unreachable — reviving via ensureDaemon()');
    daemonUrl = await ensureDaemon(project, config);
    await connectSession();
    log(`Daemon revived at ${daemonUrl}`);
  }

  // RPC wrapper with single self-heal retry (delegates to the pure helper). Note
  // the `daemonUrl` closure is re-read on retry, so the second attempt targets the
  // freshly revived daemon.
  const callRpc = (method: string, params: unknown) =>
    callWithRevive(() => rpcCall(daemonUrl, method, params), reviveDaemon);

  await connectSession();

  const server = new McpServer({ name: 'knowledge-graph', version: getRuntimeVersion() });

  // Helper: proxy tool call to daemon
  function proxyTool(
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    methodName: string,
  ) {
    server.tool(name, description, schema, async (params) => {
      try {
        // Thread session identity into every RPC as an extra field the daemon
        // can read. Does not alter the existing tool param shape. A caller-supplied
        // session_id wins (e.g. state_get_context/state_get_plan reading another
        // session, or '' to span all project sessions); otherwise use the minted id.
        const callerSessionId = (params as { session_id?: string }).session_id;
        const result = await callRpc(methodName, {
          ...params,
          session_id: callerSessionId ?? sessionId,
        });
        // Success envelope: { ok:true, data }. See "Unified response envelope".
        return { content: [{ type: 'text' as const, text: JSON.stringify(wrapSuccess(result), null, 2) }] };
      } catch (e) {
        // Error envelope: { ok:false, error:{code,message,retryable,hint} }.
        // isError:true stays (MCP standard) — the {ok:false} lives inside text.
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(wrapError(e), null, 2) }],
          isError: true,
        };
      }
    });
  }

  // ============================================================
  // Register all tools (proxy to daemon)
  // ============================================================

  proxyTool(
    'knowledge_query',
    'Search knowledge base using semantic + graph retrieval.',
    {
      query: z.string().describe('Natural language search query'),
      filters: z.object({
        domain: z.string().optional(),
        category: categoryEnum.optional(),
        importance: importanceEnum.optional(),
        tags: z.array(z.string()).optional(),
        layer: z.string().optional(),
        min_confidence: z.number().min(0).max(1).optional(),
        lifecycle: lifecycleEnum.optional(),
        since: z.string().optional(),
        limit: z.number().int().positive().optional().describe('Max results to return (default 25). Full network neighborhood is scored, then the top-N by relevance are returned.'),
      }).optional(),
    },
    'knowledge_query',
  );

  proxyTool(
    'knowledge_store',
    'Store a business logic insight as a knowledge chunk. Content should be natural language describing domain rules, business constraints, workflow rationale, or cross-feature relationships — NOT code patterns, class names, or technical implementation details. Ask the user to confirm uncertain inferences before storing. ENTITY RULES: Max 4 entities per chunk. If 2+ entities, MUST include relations[] describing how they interact. Use EntityObject {name, alias} format for entities with abbreviations.',
    { content: z.string().min(1).max(5000), metadata: metadataSchema },
    'knowledge_store',
  );

  proxyTool(
    'knowledge_link',
    'Create a relationship between two knowledge chunks.',
    {
      source_id: z.string(),
      target_id: z.string(),
      relation: relationEnum,
    },
    'knowledge_link',
  );

  proxyTool(
    'knowledge_list',
    'Browse knowledge chunks by filters.',
    {
      filters: z.object({
        domain: z.string().optional(),
        category: categoryEnum.optional(),
        importance: importanceEnum.optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        layer: z.string().optional(),
        min_confidence: z.number().min(0).max(1).optional(),
        lifecycle: lifecycleEnum.optional(),
        since: z.string().optional(),
      }).optional(),
      limit: z.number().optional(),
    },
    'knowledge_list',
  );

  proxyTool(
    'knowledge_delete',
    'Delete a knowledge chunk and all its relationships. Validated/promoted/canonical chunks require a reason.',
    { id: z.string(), reason: z.string().optional() },
    'knowledge_delete',
  );

  proxyTool(
    'knowledge_evolve',
    'Update a knowledge chunk: re-embed, version bump, re-link.',
    {
      id: z.string(),
      new_content: z.string().min(1).max(5000),
      new_metadata: z.object({
        summary: z.string().min(1).max(200).optional(),
        keywords: z.array(z.string().min(2)).min(1).max(15).optional(),
        domain: z.string().max(50).optional(),
        category: categoryEnum.optional(),
        importance: importanceEnum.optional(),
        layer: z.string().optional(),
        entities: z.array(entitySchema).max(4).optional(),
        relations: z.array(storeRelationSchema).max(4).optional(),
        suggested_relations: z.array(z.object({
          concept: z.string(),
          relation: suggestedRelationEnum,
        })).optional(),
        tags: z.array(z.string()).optional(),
      }).optional(),
      reason: z.string(),
    },
    'knowledge_evolve',
  );

  proxyTool(
    'knowledge_validate',
    'Confirm or refute a knowledge chunk. Always include evidence. See CLAUDE.md Validation Policy for golden evidence framework.',
    {
      id: z.string(),
      action: z.enum(['confirm', 'refute']),
      evidence: z.string().optional(),
      context: z.string().optional(),
    },
    'knowledge_validate',
  );

  proxyTool(
    'knowledge_promote',
    'Promote a knowledge chunk to higher status. Caller should verify golden evidence sources. See CLAUDE.md Validation Policy.',
    {
      id: z.string(),
      new_category: categoryEnum.optional(),
      new_importance: importanceEnum.optional(),
      reason: z.string(),
    },
    'knowledge_promote',
  );

  proxyTool(
    'knowledge_briefing',
    'Generate a domain overview briefing from the knowledge graph: domain summaries, stats, open questions, recent changes, stale knowledge. Use at session start for context.',
    {
      top_domains: z.number().optional().describe('Max domains to include'),
      recent_days: z.number().optional().describe('Days to look back for recent changes'),
    },
    'knowledge_briefing',
  );

  proxyTool(
    'knowledge_export',
    'Export knowledge graph as formatted markdown or JSON, grouped by domain/category/lifecycle.',
    {
      group_by: z.enum(['domain', 'category', 'lifecycle']).default('domain'),
      min_lifecycle: z.enum(['refuted', 'hypothesis', 'active', 'validated', 'promoted', 'canonical']).optional(),
      format: z.enum(['markdown', 'json']).default('markdown'),
      include_content: z.boolean().default(true),
    },
    'knowledge_export',
  );

  proxyTool(
    'knowledge_ingest',
    'Chunk raw text into knowledge candidates. Does NOT auto-store — returns candidates for review. Claude must interview the user before storing each candidate.',
    {
      content: z.string().min(1).max(50000).describe('Raw text to chunk and analyze'),
      source: z.string().optional().describe('Origin of the text'),
      domain_hint: z.string().max(50).optional().describe('Suggested domain'),
    },
    'knowledge_ingest',
  );

  // ============================================================
  // Life Knowledge tools (operational layer)
  // ============================================================

  const lifeMetadataSchema = z.object({
    summary: z.string().min(1).max(200),
    keywords: z.array(z.string().min(2)).min(1).max(15),
    domain: z.string().max(50),
    category: z.enum(['fact', 'rule', 'insight', 'workflow']),
    importance: importanceEnum,
    tags: z.array(z.string()).optional(),
    entities: z.array(z.string().min(2)).optional(),
    source: z.string().optional(),
  });

  proxyTool(
    'life_store',
    'Store an operational learning (coding gotcha, pattern, workaround). NOT for domain/business knowledge — use knowledge_store for that. Requires at least one life:* tag.',
    { content: z.string().min(1).max(5000), metadata: lifeMetadataSchema },
    'life_store',
  );

  proxyTool(
    'life_feedback',
    'Report success or failure after applying an operational learning. Adjusts score: +1 for success, -1 for failure. Score 0 = hidden, score 10 = skill-eligible.',
    { id: z.string(), outcome: z.enum(['success', 'failure']), context: z.string().optional() },
    'life_feedback',
  );

  proxyTool(
    'life_draft_skill',
    'Generate a draft Claude skill from high-score operational learnings in a domain. Does NOT auto-install — returns draft content for review.',
    { domain: z.string(), target_skill_path: z.string().optional(), force: z.boolean().optional() },
    'life_draft_skill',
  );

  // ============================================================
  // Decision record tool (durable architectural/design decisions)
  // ============================================================

  proxyTool(
    'decision_record',
    'Record an architectural/design decision with rationale and what it supersedes. Stored as durable, queryable knowledge (semantic search + supersede lineage), NOT subject to dedup so near-identical iterative decisions each persist.',
    {
      content: z.string().min(1).max(5000).describe('Natural-language description of the decision and its rationale'),
      summary: z.string().min(1).max(200).describe('One-sentence description of the decision'),
      domain: z.string().max(50).describe('Topic area for the decision'),
      keywords: z.array(z.string().min(2)).min(1).max(15).describe('Search terms'),
      importance: importanceEnum.optional().describe('Priority signal (defaults to high)'),
      supersedes_id: z.string().optional().describe('Chunk id of the decision this one replaces'),
      rationale: z.string().optional().describe('Reason for superseding the prior decision (used on the SUPERSEDES edge)'),
    },
    'decision_record',
  );

  // ============================================================
  // Session state tools (active_context — append-only working focus)
  // ============================================================

  proxyTool(
    'state_set_context',
    'Record what you are currently working on: focus, the file/feature being touched, the immediate next step. Call when you start or pivot a task so a future session can resume. Pass current_issue with an issue_ref to anchor this session to a kg beads issue — decisions/insights/knowledge you write afterward will auto-link back to that issue (the closed loop). Pass an empty string to clear the anchor.',
    {
      focus: z.string().min(1).describe('What you are currently working on (short focus statement)'),
      next_step: z.string().optional().describe('The immediate next step to take'),
      refs: z.array(z.string()).optional().describe('Files/features being touched'),
      note: z.string().optional().describe('Optional extra context'),
      current_issue: z.string().optional().describe('issue_ref to anchor this session to (chunks written afterward auto-link to it); empty string clears it'),
    },
    'state_set_context',
  );

  proxyTool(
    'state_get_context',
    "READ one session's focus trail (not tasks/plans/decisions). Returns latest focus + recent actions + next step for a single session. Use when you only need 'what was THIS session doing?'. For a full cross-session catch-up, use state_resume instead.",
    {
      session_id: z.string().optional().describe("Session to read (defaults to your own; empty string spans all sessions of the project)"),
      limit: z.number().int().positive().optional().describe('Max trail entries to return (default 10)'),
      since: z.string().optional().describe('ISO timestamp — only return entries at or after this time'),
    },
    'state_get_context',
  );

  // ============================================================
  // Plan snapshot tools (immutable, versioned plan clones)
  // ============================================================

  proxyTool(
    'state_save_plan',
    'Save a snapshot of a plan document you just wrote. Clones the file into local state storage, versioned and immutable — version 1 is the original plan.',
    {
      source_path: z.string().min(1).describe('Absolute path to the .md plan file to clone'),
      title: z.string().optional().describe('Plan title (defaults to the source filename); versions are grouped by title'),
      ts: z.string().optional().describe('Optional timestamp for the clone filename (defaults to now)'),
    },
    'state_save_plan',
  );

  proxyTool(
    'state_get_plan',
    'Retrieve a saved plan: the active version by default, or a specific version (version 1 = original). Returns the cloned file path + metadata.',
    {
      title: z.string().optional().describe('Plan title to retrieve (defaults to the most recently saved plan)'),
      version: z.number().int().positive().optional().describe('Specific version to retrieve (1 = original); omit for the active/latest version'),
      session_id: z.string().optional().describe("Project-scoped by default so a fresh session can read the original/current plan; pass another session's id to narrow to only that session's plans"),
    },
    'state_get_plan',
  );

  // ============================================================
  // Task ledger tools (progress tracking — status + blocked_by)
  // ============================================================

  proxyTool(
    'state_task_upsert',
    "Create or update a task/subtask with a status (pending/in_progress/blocked/done/deferred) and optional blocked_by references. Use to track what is done, left, or blocked across sessions. Set status='deferred' for someday/maybe work you are intentionally NOT doing now — deferred tasks are prime candidates for orphaning, so they surface in state_prune and resume nudges.",
    {
      task_id: z.string().optional().describe('Task id to update in place; omit to create a new task'),
      title: z.string().min(1).describe('Task title'),
      status: z.enum(['pending', 'in_progress', 'blocked', 'done', 'deferred']).describe("Task status. 'deferred' = someday/maybe (intentionally parked)."),
      blocked_by: z.array(z.string()).optional().describe('Task ids this task is blocked by'),
      note: z.string().optional().describe('Optional free-text note'),
      expected_version: z.number().int().positive().optional().describe('Optimistic concurrency: the version you last read. When provided on an update, the write only succeeds if the task is still at this version; otherwise it fails with a conflict instead of clobbering a concurrent update.'),
    },
    'state_task_upsert',
  );

  proxyTool(
    'state_task_list',
    "List tasks filtered by status/session. Answers 'what is the current status?' — what is done, in progress, blocked, pending, or deferred.",
    {
      session_id: z.string().optional().describe('Session to list (defaults to all sessions of the project)'),
      status: z.enum(['pending', 'in_progress', 'blocked', 'done', 'deferred']).optional().describe('Filter by status'),
    },
    'state_task_list',
  );

  // ============================================================
  // Resume + checkpoint tools (fold current state into a resume packet)
  // ============================================================

  proxyTool(
    'state_checkpoint',
    "WRITE-a-snapshot at a boundary. Folds THIS session's current context + active plan + open tasks + recent decisions into one packet. Call before a long pause or before compaction to bookmark where you are. To READ back at the start of a new session, use state_resume (project-scoped) — do not use checkpoint to read.",
    {},
    'state_checkpoint',
  );

  proxyTool(
    'state_resume',
    "THE 'catch me up' TOOL — start here at the beginning of any session. READ the full project-wide briefing: last active context, active plan, open/blocked tasks, orphaned intentions, recent decisions. Project-scoped, so it works on a brand-new session with no prior history. Prefer this over state_get_context (single-session) and state_checkpoint (write).",
    {
      since_days: z.number().int().positive().optional().describe('Only surface state touched within the last N days (default: all time)'),
    },
    'state_resume',
  );

  proxyTool(
    'state_sessions',
    'List the currently-connected sessions for this project (id, connected time, last activity). Use to see what other sessions are live.',
    {},
    'state_sessions',
  );

  proxyTool(
    'state_projection',
    'View a merged, cross-session focus/task board across all live sessions of this project — what every concurrent session is currently working on.',
    {
      project_id: z.string().optional().describe('Project to view (defaults to the current project)'),
    },
    'state_projection',
  );

  // ============================================================
  // Anti-orphaning GC (surface / evict forgotten intentions)
  // ============================================================

  proxyTool(
    'state_prune',
    "READ-ONLY. Report orphaned tasks/intentions not touched in N days (things created 'to do later' that nobody returned to). Answers 'what did I mean to do but forgot?'. Does NOT modify anything — to clear them, call state_evict_orphans separately.",
    {
      project_id: z.string().optional().describe('Project to inspect (defaults to the current project)'),
      older_than_days: z.number().int().positive().optional().describe('Age cutoff — rows not touched in this many days are orphaned (default 7)'),
    },
    'state_prune',
  );

  proxyTool(
    'state_evict_orphans',
    'DESTRUCTIVE (soft). Soft-evict (active=false) the orphaned tasks/intentions that state_prune surfaces, dropping them out of the working ledger. Pinned rows and plans are never touched. Call state_prune first to review, then this to clear.',
    {
      project_id: z.string().optional().describe('Project to evict from (defaults to the current project)'),
      older_than_days: z.number().int().positive().optional().describe('Age cutoff — rows not touched in this many days are evicted (default 7)'),
    },
    'state_evict_orphans',
  );

  proxyTool(
    'state_compact',
    'Fold old active-context events into a summary snapshot to keep the working-memory stream bounded. Pinned rows, plans, tasks, and the newest N events are never compacted.',
    {
      project_id: z.string().optional().describe('Project to compact (defaults to the current project)'),
      keep_recent: z.number().int().positive().optional().describe('Newest N active-context/event rows per session to always keep verbatim (default 50)'),
    },
    'state_compact',
  );

  // ============================================================
  // kg beads — issue tracker (first-class graph nodes)
  // ============================================================

  proxyTool(
    'issue_create',
    "Create a durable, team-synced issue/bug/ticket as a first-class graph node (kg beads). Use for actionable work that must be DONE and tracked — NOT for 'what am I doing now' (that's state_set_context) or a design rationale (that's decision_record). Returns a short issue_ref (e.g. 'upcoz-a3f9') to cite in commits/PRs. On creation it backward-scans pre-existing chunks: it auto-links high-similarity orphans (returned as auto_linked_chunks) and returns candidate_orphans (borderline matches) — review those and issue_link the relevant ones, so 'work first, file issue later' chunks are gathered instead of orphaned. Per project policy, create issues on user request/confirmation, not speculatively.",
    {
      title: z.string().min(1).max(200).describe('Short issue title (becomes the summary)'),
      description: z.string().max(5000).optional().describe('Full issue detail: repro, root cause, scope'),
      priority: issuePriorityEnum.optional().describe('p0 (highest) .. p3. Default p2'),
      blocked_by: z.array(z.string()).optional().describe('issue_ref values (short IDs, NOT UUIDs) this issue is blocked by'),
      domain: z.string().max(50).optional().describe('Topic area (default "issues")'),
      keywords: z.array(z.string().min(2)).max(15).optional().describe('Search terms (auto-derived from title if omitted)'),
    },
    'issue_create',
  );

  proxyTool(
    'issue_update',
    "Change an existing issue's priority (p0-p3), status (open/in_progress/blocked), or blocked_by list. blocked_by must contain issue_refs (short IDs like 'upcozm-a3f9'), NEVER chunk UUIDs — refs stay stable across team sync. To CLOSE a done issue, use issue_close instead. Pass expected_version (from issue_show/issue_list) for optimistic concurrency — the write is rejected if someone else changed the issue first.",
    {
      issue_ref: z.string().describe('The short issue ref to update'),
      status: issueStatusEnum.optional().describe('New status (use issue_close to close)'),
      priority: issuePriorityEnum.optional().describe('New priority'),
      blocked_by: z.array(z.string()).optional().describe('Replace the blocked_by list (issue_refs)'),
      expected_version: z.number().int().optional().describe('Optimistic CAS — reject if the current version differs'),
    },
    'issue_update',
  );

  proxyTool(
    'issue_close',
    'Close an issue when its work is done. Hides it from default lists but PRESERVES its whole linked knowledge graph (decisions/insights stay queryable). Idempotent — closing an already-closed issue is a no-op. Reach for this to finish work instead of issue_update with status:closed.',
    {
      issue_ref: z.string().describe('The short issue ref to close'),
      expected_version: z.number().int().optional().describe('Optimistic CAS — reject if the current version differs'),
    },
    'issue_close',
  );

  proxyTool(
    'issue_list',
    "List issues (each: issue_ref, title, status, priority, blocked_by, version, updated_at), sorted by priority (p0 first). Closed issues are hidden unless include_closed is true. Answers 'what issues are open / what's the backlog'. For only the unblocked ones, use issue_ready instead.",
    {
      status: issueStatusEnum.optional().describe('Filter to one status'),
      priority: issuePriorityEnum.optional().describe('Filter to one priority'),
      include_closed: z.boolean().optional().describe('Include closed issues (default false)'),
    },
    'issue_list',
  );

  proxyTool(
    'issue_show',
    "Show one issue (full content + status/priority/blocked_by) plus its linked neighborhood: the decisions, insights, and knowledge chunks connected to it by graph edges (auto-linked while working, or attached via issue_link). This is the closed-loop payoff — 'what do we know about this bug, what did we decide, what was learned, even after it's closed'.",
    {
      issue_ref: z.string().describe("The issue to show (short ref, e.g. 'upcozm-a3f9')"),
    },
    'issue_show',
  );

  proxyTool(
    'issue_link',
    "Manually attach an existing knowledge chunk (decision/insight/fact/knowledge) to an issue by creating a graph edge, so issue_show surfaces it. Use when auto-link missed it: a chunk written while the session had no current_issue anchor (find these via issue_orphans), or an older chunk from before the issue existed. The chunk_id is a Chunk UUID from issue_orphans results or knowledge_query results (NOT an issue_ref). Default relation is relates_to.",
    {
      issue_ref: z.string().describe("The issue to attach to (short ref, e.g. 'upcozm-a3f9')"),
      chunk_id: z.string().describe('Chunk UUID to attach — copy the "id" field from issue_orphans or knowledge_query results'),
      relation: relationEnum.optional().describe('Edge type (default relates_to; e.g. depends_on, contradicts)'),
    },
    'issue_link',
  );

  proxyTool(
    'issue_orphans',
    "Surface recent decision/insight chunks NOT linked to any issue — the chunk-side blind spot when current_issue was unset while writing them. Read-only; use issue_link to attach the ones that belong to an issue. Answers 'what knowledge did I capture that isn't tied to a ticket'.",
    {
      categories: z.array(z.string()).optional().describe('Chunk categories to scan (default: decision, insight)'),
      limit: z.number().int().positive().optional().describe('Max orphans to return (default 20)'),
      since: z.string().optional().describe('Only consider chunks created at/after this ISO timestamp'),
    },
    'issue_orphans',
  );

  proxyTool(
    'issue_ready',
    "List ready-to-work issues: open/in_progress issues whose every blocker is closed (like `bd ready`). Priority-sorted (p0 first). Answers 'what can I pick up next that isn't blocked'.",
    {
      priority: issuePriorityEnum.optional().describe('Filter to one priority'),
    },
    'issue_ready',
  );

  proxyTool(
    'issue_stale',
    "Read-only anti-graveyard report: open/in_progress issues untouched for N days (default 14), oldest first. Symmetric to state_prune for session memory. Answers 'what backlog have we forgotten'.",
    {
      days: z.number().int().positive().optional().describe('Staleness threshold in days (default 14)'),
    },
    'issue_stale',
  );

  // ============================================================
  // Attachment tools — content-addressed image evidence
  // ============================================================

  const attachTargetSchema = {
    chunk_id: z.string().optional().describe('Target chunk UUID (mutually exclusive with issue_ref)'),
    issue_ref: z.string().optional().describe("Target issue ref, e.g. 'upcozm-a3f9' (mutually exclusive with chunk_id)"),
  };

  proxyTool(
    'attachment_add',
    "Attach an evidence IMAGE (screenshot/photo/pdf) to an existing chunk or issue. The KG COPIES the file's bytes into itself (content-addressed by sha256), so the original can be deleted and the team gets it via git. Use for VISUAL proof of something already captured as a chunk/issue (e.g. 6 dialog screenshots proving a bug) — the image never stands alone, it always attaches to a chunk/issue. Caption is display-only (NOT searched). Returns rel_path you can then Read to view the image.",
    {
      source: z.string().min(1).describe('Absolute/relative path to a local image or pdf file to copy into the KG'),
      ...attachTargetSchema,
      caption: z.string().max(500).optional().describe('Display-only caption (NOT indexed for search)'),
    },
    'attachment_add',
  );

  proxyTool(
    'attachment_list',
    "List the evidence images attached to a chunk or issue: each with sha256, rel_path (Read it to view), filename, caption, mime, size. Answers 'what screenshots are on this issue/decision'. Missing bytes are skipped with a warning.",
    {
      ...attachTargetSchema,
    },
    'attachment_list',
  );

  proxyTool(
    'attachment_remove',
    'Detach an image (by sha256) from a chunk or issue. When no chunk references the image anymore, its bytes-index row and on-disk bytes are garbage-collected. Other chunks that still reference the same image keep it.',
    {
      sha256: z.string().min(1).describe('The content hash of the attachment to remove (from attachment_list)'),
      ...attachTargetSchema,
    },
    'attachment_remove',
  );

  proxyTool(
    'attachment_gc',
    "Report (and optionally evict) orphaned attachments: index rows referenced by zero chunks, and on-disk bytes files with no index row. Read-only by default (parity with issue_orphans/state_prune) — pass evict:true to actually delete.",
    {
      evict: z.boolean().optional().describe('Actually delete the orphans (default false = report only)'),
    },
    'attachment_gc',
  );

  // ============================================================
  // Connect to stdio transport
  // ============================================================

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`MCP client connected (project: ${projectId}, daemon: ${daemonUrl})`);

  // SIGINT (Ctrl+C): user explicitly wants to stop everything — kill daemon
  process.on('SIGINT', async () => {
    try {
      await fetch(`${daemonUrl}/rpc/shutdown`, { method: 'POST' }).catch(() => {});
      await server.close();
    } catch { /* ignore */ }
    process.exit(0);
  });

  // SIGTERM (Claude Code exiting): preserve daemon for other sessions
  process.on('SIGTERM', async () => {
    try {
      await fetch(`${daemonUrl}/rpc/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => {});
      await server.close();
    } catch { /* ignore */ }
    process.exit(0);
  });
}
