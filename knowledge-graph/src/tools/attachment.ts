import { createHash, randomBytes } from 'crypto';
import {
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join, basename, extname } from 'path';
import { IStorage } from '../storage/interface.js';
import { StoredChunk, AttachmentRow, log } from '../types.js';
import { findByRef } from './issue.js';

/**
 * attachment — content-addressed image evidence attached to any chunk/issue.
 *
 * Design (see plan "Quyết định linkage-storage"):
 *  - Bytes are copied INTO the KG at `.knowledge-graph/attachments/<sha256>.<ext>`
 *    (content-addressed → natural dedup; git-committed → synced with the team).
 *  - The Attachment ROW is a pure bytes index (sha256, filename, mime, size_bytes).
 *    It holds NO chunk linkage and NO caption.
 *  - Linkage + caption live on the CHUNK as `attachment_refs: string[]`, each element
 *    "<sha256>|<caption>" — synced via the existing chunk sync file (like blocked_by).
 *  - Images are NEVER embedded; the Attachment table has no vector index. This code
 *    never touches the Chunk embedding/search pipeline.
 */

/** Default max attachment size — 10 MB. */
export const DEFAULT_ATTACHMENT_CAP_BYTES = 10 * 1024 * 1024;

/** Allowed on-disk extensions (sanitized). */
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf']);

/** Split one `attachment_refs` element "<sha256>|<caption>" into parts. */
function parseRef(ref: string): { sha256: string; caption: string } {
  const idx = ref.indexOf('|');
  if (idx === -1) return { sha256: ref, caption: '' };
  return { sha256: ref.slice(0, idx), caption: ref.slice(idx + 1) };
}

/** Build one `attachment_refs` element from a sha + caption. */
function makeRef(sha256: string, caption: string): string {
  return `${sha256}|${caption ?? ''}`;
}

/**
 * Sniff magic bytes → { ext, mime }. Falls back to the filename extension
 * (sanitized to the allowed image/pdf set), then to a generic binary type.
 * Magic-byte detection wins so a mislabeled `.txt` screenshot still stores correctly.
 */
function sniffType(bytes: Buffer, source: string): { ext: string; mime: string } {
  // PNG: 89 50 4E 47
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // GIF: 47 49 46 38 ("GIF8")
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { ext: 'gif', mime: 'image/gif' };
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  // PDF: 25 50 44 46 ("%PDF")
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { ext: 'pdf', mime: 'application/pdf' };
  }

  // Fallback: filename extension, sanitized.
  const rawExt = extname(source).replace(/^\./, '').toLowerCase();
  if (rawExt && ALLOWED_EXT.has(rawExt)) {
    const mime =
      rawExt === 'jpg' || rawExt === 'jpeg' ? 'image/jpeg' :
      rawExt === 'pdf' ? 'application/pdf' :
      `image/${rawExt}`;
    return { ext: rawExt === 'jpeg' ? 'jpg' : rawExt, mime };
  }

  // Unknown/empty extension → generic binary.
  return { ext: 'bin', mime: 'application/octet-stream' };
}

interface HashAndCopyResult {
  sha256: string;
  ext: string;
  mime: string;
  size_bytes: number;
  original_filename: string;
  disk_filename: string; // "<sha256>.<ext>"
  existed: boolean; // true when dedup skipped the byte copy
}

/**
 * statSync FIRST (reject before reading a single byte), then hash + sniff + copy.
 * Copy is atomic (temp file + rename) and dedup-aware (skips write if the
 * content-addressed destination already exists).
 *
 * Error messages are crafted for P4 classifyError: "invalid source: ..." for
 * missing/dir/non-file, "file too large (max ...)" for oversize.
 */
export function hashAndCopy(
  source: string,
  attachmentsDir: string,
  cap: number = DEFAULT_ATTACHMENT_CAP_BYTES,
): HashAndCopyResult {
  if (!source || !source.trim()) {
    throw new Error('invalid source: empty path');
  }

  // 1) stat BEFORE reading — reject non-files and oversize without loading bytes.
  let st;
  try {
    st = statSync(source);
  } catch {
    throw new Error(`invalid source: ${source} (not found)`);
  }
  if (st.isDirectory()) {
    throw new Error(`invalid source: ${source} (is a directory, not a file)`);
  }
  if (!st.isFile()) {
    throw new Error(`invalid source: ${source} (not a regular file)`);
  }
  if (st.size > cap) {
    throw new Error(`file too large (max ${cap} bytes, got ${st.size} bytes): ${source}`);
  }

  // 2) read + hash + sniff.
  const bytes = readFileSync(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { ext, mime } = sniffType(bytes, source);
  const diskFilename = `${sha256}.${ext}`;
  const dest = join(attachmentsDir, diskFilename);

  // 3) atomic copy (temp + rename), dedup: skip if content already on disk.
  const existed = existsSync(dest);
  if (!existed) {
    mkdirSync(attachmentsDir, { recursive: true });
    const tmp = join(attachmentsDir, `.tmp-${sha256.slice(0, 12)}-${randomBytes(4).toString('hex')}`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
  }

  return {
    sha256,
    ext,
    mime,
    size_bytes: bytes.length,
    original_filename: basename(source),
    disk_filename: diskFilename,
    existed,
  };
}

/**
 * Resolve a chunk from either a chunk_id (UUID) or an issue_ref (short, sync-stable).
 * Reuses findByRef for the issue branch and storage.getChunk for the id branch.
 * Exactly one of the two must be supplied.
 */
export async function resolveChunk(
  storage: IStorage,
  ref: { chunk_id?: string; issue_ref?: string },
): Promise<StoredChunk> {
  const hasChunkId = !!ref.chunk_id?.trim();
  const hasIssueRef = !!ref.issue_ref?.trim();
  if (!hasChunkId && !hasIssueRef) {
    throw new Error('requires either chunk_id or issue_ref to identify the target chunk');
  }
  if (hasChunkId && hasIssueRef) {
    throw new Error('provide only one of chunk_id or issue_ref, not both');
  }

  if (hasIssueRef) {
    const issue = await findByRef(storage, ref.issue_ref!);
    if (!issue) throw new Error(`Issue not found: ${ref.issue_ref}`);
    return issue;
  }
  const chunk = await storage.getChunk(ref.chunk_id!);
  if (!chunk) throw new Error(`Chunk not found: ${ref.chunk_id}`);
  return chunk;
}

/** Find the on-disk bytes file for a sha (any allowed ext). Returns abs path or null. */
function findBytesFile(attachmentsDir: string, sha256: string): string | null {
  if (!existsSync(attachmentsDir)) return null;
  for (const name of readdirSync(attachmentsDir)) {
    if (name.startsWith(`${sha256}.`)) return join(attachmentsDir, name);
  }
  return null;
}

/** Relative path (from the project root) an agent can Read. */
function relPath(diskFilename: string): string {
  return join('.knowledge-graph', 'attachments', diskFilename);
}

// ============================================================
// attachment_add
// ============================================================

/**
 * Copy `source` into the KG, upsert its bytes-index row, and append the
 * "<sha256>|<caption>" ref to the target chunk. Dedup-safe on every axis:
 * same image → 1 file; same sha → 1 row; same sha on same chunk → 1 ref.
 */
export async function handleAttachmentAdd(
  storage: IStorage,
  kgDir: string,
  args: {
    source: string;
    attach_to?: { chunk_id?: string; issue_ref?: string };
    chunk_id?: string;
    issue_ref?: string;
    caption?: string;
    cap?: number;
  },
): Promise<{
  sha256: string;
  rel_path: string;
  path: string;
  filename: string;
  mime: string;
  size_bytes: number;
  deduped: boolean;
  chunk_id: string;
  warnings: string[];
}> {
  const target = args.attach_to ?? { chunk_id: args.chunk_id, issue_ref: args.issue_ref };
  const chunk = await resolveChunk(storage, target);

  const attachmentsDir = join(kgDir, 'attachments');
  const copied = hashAndCopy(args.source, attachmentsDir, args.cap ?? DEFAULT_ATTACHMENT_CAP_BYTES);

  // Upsert the bytes-index row (immutable — only create if absent).
  const existingRow = await storage.getAttachment(copied.sha256);
  if (!existingRow) {
    await storage.createAttachment({
      sha256: copied.sha256,
      filename: copied.original_filename,
      mime: copied.mime,
      size_bytes: copied.size_bytes,
    });
  }

  // Append the ref to the chunk (dedup: skip if this sha is already referenced here).
  const caption = args.caption ?? '';
  const refs = [...(chunk.attachment_refs ?? [])];
  const alreadyRefed = refs.some((r) => parseRef(r).sha256 === copied.sha256);
  const warnings: string[] = [];
  if (!alreadyRefed) {
    refs.push(makeRef(copied.sha256, caption));
    await storage.updateChunk(chunk.id, { attachment_refs: refs });
  } else {
    warnings.push(`sha ${copied.sha256.slice(0, 12)}… already attached to this chunk — kept existing ref (caption unchanged)`);
  }

  // A chunk with no sync_id (rare operational layer) stores bytes locally but its
  // linkage will not sync — warn per plan "Ngoài phạm vi", do not block.
  if (!chunk.sync_id) {
    warnings.push('target chunk has no sync_id — bytes are stored locally but this linkage will NOT sync to the team');
  }

  log('attachment_add:', copied.sha256.slice(0, 12), '→ chunk', chunk.id, copied.existed ? '(deduped)' : '(new bytes)');
  return {
    sha256: copied.sha256,
    rel_path: relPath(copied.disk_filename),
    path: join(attachmentsDir, copied.disk_filename),
    filename: copied.original_filename,
    mime: copied.mime,
    size_bytes: copied.size_bytes,
    deduped: copied.existed || alreadyRefed,
    chunk_id: chunk.id,
    warnings,
  };
}

// ============================================================
// attachment_list
// ============================================================

/**
 * List every attachment on a chunk: parse its attachment_refs, join the bytes-index
 * row for filename/mime/size, and confirm bytes exist on disk. Rows/bytes that have
 * gone missing are skipped with a warning (never throws).
 */
export async function handleAttachmentList(
  storage: IStorage,
  kgDir: string,
  args: { chunk_id?: string; issue_ref?: string; attach_to?: { chunk_id?: string; issue_ref?: string } },
): Promise<{
  chunk_id: string;
  attachments: Array<{
    sha256: string;
    rel_path: string;
    path: string;
    filename: string;
    caption: string;
    mime: string;
    size_bytes: number;
  }>;
  warnings: string[];
}> {
  const target = args.attach_to ?? { chunk_id: args.chunk_id, issue_ref: args.issue_ref };
  const chunk = await resolveChunk(storage, target);
  const attachmentsDir = join(kgDir, 'attachments');

  const attachments: Array<{
    sha256: string; rel_path: string; path: string; filename: string; caption: string; mime: string; size_bytes: number;
  }> = [];
  const warnings: string[] = [];

  for (const ref of chunk.attachment_refs ?? []) {
    const { sha256, caption } = parseRef(ref);
    const row = await storage.getAttachment(sha256);
    const bytesPath = findBytesFile(attachmentsDir, sha256);
    if (!bytesPath) {
      warnings.push(`bytes missing for sha ${sha256.slice(0, 12)}… — skipped (row ${row ? 'present' : 'also missing'})`);
      continue;
    }
    const diskFilename = basename(bytesPath);
    attachments.push({
      sha256,
      rel_path: relPath(diskFilename),
      path: bytesPath,
      filename: row?.filename ?? diskFilename,
      caption,
      mime: row?.mime ?? sniffMimeFromName(diskFilename),
      size_bytes: row?.size_bytes ?? 0,
    });
  }

  return { chunk_id: chunk.id, attachments, warnings };
}

/** Best-effort mime from a filename when the index row is missing. */
function sniffMimeFromName(name: string): string {
  const ext = extname(name).replace(/^\./, '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'pdf') return 'application/pdf';
  if (ALLOWED_EXT.has(ext)) return `image/${ext}`;
  return 'application/octet-stream';
}

// ============================================================
// attachment_remove
// ============================================================

/**
 * Strip the ref for `sha256` from the chunk. If no chunk references the sha
 * anymore (ref-count → 0), delete the bytes-index row and the on-disk bytes.
 */
export async function handleAttachmentRemove(
  storage: IStorage,
  kgDir: string,
  args: {
    sha256: string;
    attach_to?: { chunk_id?: string; issue_ref?: string };
    chunk_id?: string;
    issue_ref?: string;
  },
): Promise<{
  sha256: string;
  chunk_id: string;
  removed_ref: boolean;
  row_deleted: boolean;
  bytes_deleted: boolean;
  remaining_refs: number;
}> {
  if (!args.sha256?.trim()) throw new Error('requires a sha256 to remove');
  const target = args.attach_to ?? { chunk_id: args.chunk_id, issue_ref: args.issue_ref };
  const chunk = await resolveChunk(storage, target);

  const before = chunk.attachment_refs ?? [];
  const after = before.filter((r) => parseRef(r).sha256 !== args.sha256);
  const removedRef = after.length !== before.length;
  if (removedRef) {
    await storage.updateChunk(chunk.id, { attachment_refs: after });
  }

  // Ref-count across ALL chunks — GC bytes only when nobody references the sha.
  const remaining = await storage.countAttachmentRefs(args.sha256);
  let rowDeleted = false;
  let bytesDeleted = false;
  if (remaining === 0) {
    const row = await storage.getAttachment(args.sha256);
    if (row) {
      await storage.deleteAttachment(args.sha256);
      rowDeleted = true;
    }
    const bytesPath = findBytesFile(join(kgDir, 'attachments'), args.sha256);
    if (bytesPath) {
      try { unlinkSync(bytesPath); bytesDeleted = true; } catch (e) { log('attachment_remove: failed to unlink bytes', bytesPath, e); }
    }
  }

  log('attachment_remove:', args.sha256.slice(0, 12), 'from chunk', chunk.id, `remaining=${remaining}`);
  return { sha256: args.sha256, chunk_id: chunk.id, removed_ref: removedRef, row_deleted: rowDeleted, bytes_deleted: bytesDeleted, remaining_refs: remaining };
}

// ============================================================
// attachment_gc
// ============================================================

/**
 * Report (and optionally evict) orphans in the content store:
 *  - orphan_rows: Attachment rows referenced by zero chunks.
 *  - orphan_bytes: on-disk bytes files with no matching row.
 * Read-only by default (parity with issue_orphans / state_prune); pass evict:true
 * to actually delete.
 */
export async function handleAttachmentGc(
  storage: IStorage,
  kgDir: string,
  args: { evict?: boolean } = {},
): Promise<{
  orphan_rows: string[];
  orphan_bytes: string[];
  evicted: boolean;
  rows_deleted: number;
  bytes_deleted: number;
}> {
  const attachmentsDir = join(kgDir, 'attachments');

  // Orphan rows: 0 refs across all chunks.
  const rows = await storage.listAttachments({});
  const orphanRows: string[] = [];
  for (const row of rows) {
    const count = await storage.countAttachmentRefs(row.sha256);
    if (count === 0) orphanRows.push(row.sha256);
  }

  // Orphan bytes: files on disk whose sha has no index row.
  const rowShas = new Set(rows.map((r) => r.sha256));
  const orphanBytes: string[] = [];
  if (existsSync(attachmentsDir)) {
    for (const name of readdirSync(attachmentsDir)) {
      if (name.startsWith('.tmp-')) continue; // in-flight temp files
      const sha = name.split('.')[0];
      if (!rowShas.has(sha)) orphanBytes.push(name);
    }
  }

  let rowsDeleted = 0;
  let bytesDeleted = 0;
  if (args.evict) {
    for (const sha of orphanRows) {
      await storage.deleteAttachment(sha);
      rowsDeleted++;
      const bytesPath = findBytesFile(attachmentsDir, sha);
      if (bytesPath) {
        try { unlinkSync(bytesPath); bytesDeleted++; } catch (e) { log('attachment_gc: failed to unlink', bytesPath, e); }
      }
    }
    for (const name of orphanBytes) {
      try { unlinkSync(join(attachmentsDir, name)); bytesDeleted++; } catch (e) { log('attachment_gc: failed to unlink', name, e); }
    }
  }

  return {
    orphan_rows: orphanRows,
    orphan_bytes: orphanBytes,
    evicted: !!args.evict,
    rows_deleted: rowsDeleted,
    bytes_deleted: bytesDeleted,
  };
}

/**
 * Parse a chunk's attachment_refs into a display list for issue_show. Bytes/rows
 * are NOT joined here (keep it cheap + sync-free) — just sha + caption + rel_path.
 */
export function parseAttachmentRefs(chunk: Pick<StoredChunk, 'attachment_refs'>): Array<{ sha256: string; caption: string; rel_path: string }> {
  return (chunk.attachment_refs ?? []).map((ref) => {
    const { sha256, caption } = parseRef(ref);
    // rel_path stem only — ext unknown without a disk lookup; callers that need the
    // exact file use attachment_list. issue_show shows the sha-addressed dir path.
    return { sha256, caption, rel_path: join('.knowledge-graph', 'attachments', sha256) };
  });
}

/** Exported for reuse/testing. */
export { parseRef, makeRef };
export type { AttachmentRow };
