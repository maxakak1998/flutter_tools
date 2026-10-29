import { IStorage } from '../storage/interface.js';

/**
 * Chunk-id prefix resolution. Listings and logs show 8-char short ids, and callers
 * paste them straight into knowledge_evolve & co. — which used to fail "Chunk not
 * found". Every daemon RPC param that holds a chunk id goes through here first.
 */

// Shortest prefix accepted. 8 hex chars = 4B combinations, so a collision in a
// few-thousand-chunk graph is rare, and when it happens the caller gets the candidates.
export const MIN_CHUNK_ID_PREFIX = 8;
// Candidates listed in the ambiguity error.
const MAX_CANDIDATES = 5;
// A full UUID is 36 chars; only shorter hex(+dash) strings are treated as prefixes.
const FULL_ID_LENGTH = 36;
const PREFIX_RE = /^[0-9a-f][0-9a-f-]*$/i;

/** RPC method → params that carry a chunk id. */
export const CHUNK_ID_PARAMS: Record<string, readonly string[]> = {
  knowledge_link: ['source_id', 'target_id'],
  knowledge_delete: ['id'],
  knowledge_evolve: ['id'],
  knowledge_validate: ['id'],
  knowledge_promote: ['id'],
  life_feedback: ['id'],
  decision_record: ['supersedes_id'],
  issue_link: ['chunk_id'],
  attachment_add: ['chunk_id'],
  attachment_list: ['chunk_id'],
  attachment_remove: ['chunk_id'],
};

/**
 * Resolve `value` to a full chunk id. An exact id, a non-prefix-shaped value (e.g.
 * "archive-…", a full UUID) or a prefix with no match is returned unchanged, so the
 * handler reports "not found" as before. A unique prefix returns the full id; an
 * ambiguous prefix throws a validation error listing the candidates.
 */
export async function resolveChunkId(storage: IStorage, value: string): Promise<string> {
  const v = value.trim();
  if (v.length < MIN_CHUNK_ID_PREFIX || v.length >= FULL_ID_LENGTH || !PREFIX_RE.test(v)) return value;
  const ids = await storage.findChunkIdsByPrefix(v, MAX_CANDIDATES + 1);
  if (ids.includes(v)) return v;
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) return value;
  const shown = ids.slice(0, MAX_CANDIDATES).join(', ');
  const more = ids.length > MAX_CANDIDATES ? ', …' : '';
  throw new Error(`Ambiguous chunk id prefix "${v}" matches multiple chunks (${shown}${more}) — pass more characters`);
}

/** Return `params` with every chunk-id field of `method` resolved (a copy; input untouched). */
export async function resolveChunkIdParams(
  storage: IStorage,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const keys = CHUNK_ID_PARAMS[method];
  if (!keys || !params) return params;
  let out = params;
  for (const key of keys) {
    const raw = params[key];
    if (typeof raw !== 'string' || !raw) continue;
    const resolved = await resolveChunkId(storage, raw);
    if (resolved !== raw) {
      if (out === params) out = { ...params };
      out[key] = resolved;
    }
  }
  return out;
}
