// ============================================================
// Machine-wide SESSION DICTIONARY.
//
// One JSON file per Claude Code session at `<sessionsDir>/<id>.json`, shared by
// every project on this machine (local only, never git-synced). It lets every
// KG tool call be attributed to a ROOT session: subagents share the parent's MCP
// process, pane teammates point at their lead via `parent_id`, and `/clear` /
// `/resume` chain via `continues_id`. `root_id` is computed on read, never stored
// (a stored value goes stale when a mid-chain node is re-parented).
//
// Lenient by design: only `id` is required, unknown fields are preserved, auto-
// detection only fills EMPTY fields, and every function here fails open — the
// dictionary must never fail a KG tool call. Single source of truth for the file
// format, shared by the client (resolve + register), the CLI (`kg session ...`),
// and the hooks (audit, prime).
//
// The sessions dir defaults to `~/.knowledge-graph/sessions`; tests redirect it by
// setting `KG_SESSIONS_DIR` (or HOME). Never console.log here — the client runs
// this on the MCP stdio path; use log().
// ============================================================

import { join } from 'path';
import { homedir } from 'os';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { sanitizeSessionId } from './goal-store.js';
import { log } from './types.js';

export type SessionRecord = { id: string } & Record<string, unknown>;

/** Strict identity: a missing session id is an ERROR, never a silent fallback. */
export const MISSING_SESSION_ID_MESSAGE =
  'no Claude Code session id: CLAUDE_CODE_SESSION_ID is not set (every KG tool call must carry a session id)';
export const MISSING_CLIENT_SESSION_ID_MESSAGE =
  "client_session_id is required: every tool call must carry the caller's session id";

/** Session id for a manual CLI command: explicit value (--session) else CLAUDE_CODE_SESSION_ID, else ''. */
export function cliSessionId(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  return (explicit || env.CLAUDE_CODE_SESSION_ID || '').trim();
}

export const MAX_ROOT_HOPS = 16;
export const LAST_SEEN_MIN_INTERVAL_MS = 60_000;
export const AUDIT_LINE_MAX_BYTES = 4096;

export function sessionsDir(): string {
  return process.env.KG_SESSIONS_DIR || join(homedir(), '.knowledge-graph', 'sessions');
}

export function sessionFilePath(id: string, dir = sessionsDir()): string {
  return join(dir, `${sanitizeSessionId(id)}.json`);
}

export function auditFilePath(id: string, dir = sessionsDir()): string {
  return join(dir, `${sanitizeSessionId(id)}.audit.jsonl`);
}

/** Read one session, or null if missing / unreadable / not an object. Never throws. */
export function readSession(id: string, dir = sessionsDir()): SessionRecord | null {
  const s = sanitizeSessionId(id);
  if (!s) return null;
  try {
    const p = sessionFilePath(s, dir);
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // The filename is authoritative for `id` (a hand edit may have dropped it).
    return { ...parsed, id: s };
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename) of a full record. Unknown fields are kept as given. */
export function writeSession(rec: SessionRecord, dir = sessionsDir()): SessionRecord {
  const s = sanitizeSessionId(rec.id);
  if (!s) throw new Error('writeSession: empty/invalid session id');
  const out = { ...rec, id: s };
  mkdirSync(dir, { recursive: true });
  const p = sessionFilePath(s, dir);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
  renameSync(tmp, p);
  return out;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

/**
 * Fill-empty-only upsert: for each field in `fields`, set it only if the existing
 * value is empty (undefined / null / ''). Creates the record when missing (a
 * corrupt file is treated as missing and rewritten). Returns the record and whether
 * anything was written. Never overwrites a value a human (or earlier detection) set.
 */
export function fillSession(
  id: string,
  fields: Record<string, unknown>,
  dir = sessionsDir(),
): { record: SessionRecord; changed: boolean } {
  const s = sanitizeSessionId(id);
  const existing = readSession(s, dir);
  const record: SessionRecord = existing ?? { id: s };
  let changed = !existing;
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'id' || isEmpty(v)) continue;
    if (isEmpty(record[k])) {
      record[k] = v;
      changed = true;
    }
  }
  if (changed) writeSession(record, dir);
  return { record, changed };
}

/**
 * Explicit edit (CLI / session_update): overwrites the given fields, preserves all
 * others. A value of null deletes the field. Returns the record plus a warning if the
 * edit created a parent/continuation cycle (allowed, but flagged).
 */
export function updateSession(
  id: string,
  fields: Record<string, unknown>,
  dir = sessionsDir(),
): { record: SessionRecord; warning?: string } {
  const s = sanitizeSessionId(id);
  if (!s) throw new Error('updateSession: empty/invalid session id');
  const record: SessionRecord = readSession(s, dir) ?? { id: s };
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'id') continue;
    if (v === null) delete record[k];
    else record[k] = v;
  }
  writeSession(record, dir);
  const { cycle } = resolveRootDetailed(s, dir);
  return { record, ...(cycle ? { warning: `link creates a cycle through ${s}; root falls back to the node where the cycle was detected` } : {}) };
}

/** Parent link of a record: `parent_id ?? continues_id`, sanitized, '' if none. */
function linkOf(rec: SessionRecord | null): string {
  if (!rec) return '';
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? sanitizeSessionId(v) : '');
  return pick(rec.parent_id) || pick(rec.continues_id);
}

/**
 * Follow `parent_id ?? continues_id` up to MAX_ROOT_HOPS with a visited set. On a
 * cycle, a dangling reference (the linked session has no file) or hop exhaustion,
 * the current node is treated as root and a warning is logged. A session with no
 * file at all is its own root (fresh/unknown sessions must still resolve).
 */
export function resolveRootDetailed(
  id: string,
  dir = sessionsDir(),
): { root: string; chain: string[]; cycle: boolean; dangling: boolean } {
  let cur = sanitizeSessionId(id);
  const chain = [cur];
  const visited = new Set<string>([cur]);
  let cycle = false;
  let dangling = false;
  for (let hop = 0; hop < MAX_ROOT_HOPS; hop++) {
    const next = linkOf(readSession(cur, dir));
    if (!next) break;
    if (visited.has(next)) {
      cycle = true;
      log(`session-dictionary: cycle detected at ${cur} -> ${next}; treating ${cur} as root`);
      break;
    }
    if (!existsSync(sessionFilePath(next, dir))) {
      dangling = true;
      log(`session-dictionary: dangling link ${cur} -> ${next}; treating ${cur} as root`);
      break;
    }
    visited.add(next);
    chain.push(next);
    cur = next;
    if (hop === MAX_ROOT_HOPS - 1) log(`session-dictionary: hop limit reached at ${cur}; treating it as root`);
  }
  return { root: cur, chain, cycle, dangling };
}

export function resolveRoot(id: string, dir = sessionsDir()): string {
  return resolveRootDetailed(id, dir).root;
}

/** All sessions, newest `last_seen` (else `started_at`) first. Unreadable files skipped. */
export function listSessions(dir = sessionsDir()): SessionRecord[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: SessionRecord[] = [];
  for (const f of files) {
    const rec = readSession(f.slice(0, -'.json'.length), dir);
    if (rec) out.push(rec);
  }
  const key = (r: SessionRecord) => String(r.last_seen ?? r.started_at ?? '');
  return out.sort((a, b) => key(b).localeCompare(key(a)));
}

/**
 * Touch `last_seen`, at most once per LAST_SEEN_MIN_INTERVAL_MS. Fail-open.
 * Returns true if a write happened.
 */
export function touchLastSeen(id: string, dir = sessionsDir(), now = Date.now()): boolean {
  try {
    const rec = readSession(id, dir);
    if (!rec) return false;
    const prev = typeof rec.last_seen === 'string' ? Date.parse(rec.last_seen) : NaN;
    if (!Number.isNaN(prev) && now - prev < LAST_SEEN_MIN_INTERVAL_MS) return false;
    rec.last_seen = new Date(now).toISOString();
    writeSession(rec, dir);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------

export interface AuditEntry {
  ts: string;
  session_id: string;
  root_id: string;
  agent_id: string | null;
  agent_type: string | null;
  tool: string;
  ok: boolean;
  refs: string[];
}

/** Serialize an audit entry to one line under AUDIT_LINE_MAX_BYTES, truncating `refs`. */
export function formatAuditLine(entry: AuditEntry): string {
  const refs = [...entry.refs];
  let line = JSON.stringify({ ...entry, refs });
  while (Buffer.byteLength(line, 'utf-8') + 1 > AUDIT_LINE_MAX_BYTES && refs.length > 0) {
    refs.pop();
    line = JSON.stringify({ ...entry, refs, refs_truncated: true });
  }
  return line;
}

/** Append one audit line to `<id>.audit.jsonl` (keyed by the ROOT id). Fail-open. */
export function appendAudit(entry: AuditEntry, dir = sessionsDir()): void {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(auditFilePath(entry.root_id, dir), formatAuditLine(entry) + '\n', 'utf-8');
  } catch (e) {
    log('session-dictionary: audit append failed (non-fatal):', e);
  }
}

// ----------------------------------------------------------------
// Detection helpers (teammate, continuation)
// ----------------------------------------------------------------

/**
 * Parse `--agent-id <name>@<team>` out of a Claude Code process command line.
 * Teammates are launched as `claude --agent-id <name>@<team> ...`; a normal main
 * session has no such flag. Returns null when absent (=> NOT a teammate).
 */
export function parseAgentId(argv: string): { agent_id: string; name: string; team: string } | null {
  const m = /--agent-id[= ]+([^\s@]+)@(\S+)/.exec(argv || '');
  return m ? { agent_id: `${m[1]}@${m[2]}`, name: m[1], team: m[2] } : null;
}

/** Best-effort command line of a process (`ps`). '' on any failure (fail-open). */
export function readProcessArgv(pid: number): string {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Teammate detection. The MCP client's parent process is the Claude Code process;
 * only if ITS argv carries `--agent-id <name>@<team>` is this a teammate, and then the
 * lead is `leadSessionId` from `<teamsDir>/<team>/config.json`. No flag => never a
 * teammate (a main session in a tmux pane whose id a stale team config still lists
 * must NOT be adopted — which is why pane-id matching was dropped; pane ids are
 * reused). If the flag is present but the team config is unreadable, returns the
 * agent_id with an empty lead (parent_id is left unset). Fail-open.
 */
export function detectTeammate(
  argv: string,
  teamsDir = join(homedir(), '.claude', 'teams'),
): { agent_id: string; lead: string } | null {
  const a = parseAgentId(argv);
  if (!a) return null;
  let lead = '';
  try {
    // Team name comes from argv: refuse anything path-like.
    if (!/^[A-Za-z0-9._-]+$/.test(a.team) || a.team.includes('..')) throw new Error('bad team name');
    const cfg = JSON.parse(readFileSync(join(teamsDir, a.team, 'config.json'), 'utf-8'));
    if (typeof cfg.leadSessionId === 'string') lead = cfg.leadSessionId;
  } catch { /* unreadable team config */ }
  return { agent_id: a.agent_id, lead };
}

/**
 * Per-Claude-process key for the continuation pointer. Prefer the PID embedded in
 * CLAUDE_CODE_MESSAGING_SOCKET (`/tmp/cc-socks/<pid>.sock`) — it is the Claude Code
 * process, which survives /clear; else the tmux pane; else '' (skip chaining).
 */
export function procKey(env: NodeJS.ProcessEnv = process.env): string {
  const sock = env.CLAUDE_CODE_MESSAGING_SOCKET || '';
  const m = /(\d+)\.sock$/.exec(sock);
  if (m) return `pid-${m[1]}`;
  const pane = env.TMUX_PANE || '';
  if (/^%\d+$/.test(pane)) return `pane-${pane.slice(1)}`;
  return '';
}

function procFile(key: string, dir: string): string {
  return join(dir, '.proc', key.replace(/[^A-Za-z0-9_-]/g, ''));
}

/**
 * Record `newId` as the latest session of this Claude process and return the PREVIOUS
 * id held there ('' if none / same id / no key). Fail-open.
 */
export function swapProcPointer(key: string, newId: string, dir = sessionsDir()): string {
  if (!key) return '';
  const s = sanitizeSessionId(newId);
  if (!s) return '';
  try {
    const p = procFile(key, dir);
    let prev = '';
    try { prev = sanitizeSessionId(readFileSync(p, 'utf-8').trim()); } catch { /* none yet */ }
    mkdirSync(join(dir, '.proc'), { recursive: true });
    writeFileSync(p, s, 'utf-8');
    return prev && prev !== s ? prev : '';
  } catch {
    return '';
  }
}
