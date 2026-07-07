import { join, dirname } from 'path';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { IStorage } from '../storage/interface.js';
import { AttachmentRow, log } from '../types.js';
import { stableStringify } from './format.js';

/**
 * attachment-sync — the SEPARATE sync path for attachment BYTES metadata.
 *
 * Bytes themselves live at `.knowledge-graph/attachments/<sha256>.<ext>` and are
 * git-committed directly (not gitignored) — so they travel with the repo. What does
 * NOT travel automatically is the Attachment ROW (a per-machine DB index of
 * sha256→filename/mime/size). We publish that row as one tiny JSON per sha under
 * `.knowledge-graph/sync/attachments/<sha256>.json`, and rebuild it on import.
 *
 * Linkage + caption do NOT live here — they ride the chunk sync file via
 * `attachment_refs`. This file only carries immutable byte metadata.
 *
 * NB: attachments are NEVER embedded and this module never touches the Chunk
 * search/embedding pipeline — it mirrors the non-embedded SessionState pattern.
 */

// ============================================================
// Shape of one sync/attachments/<sha256>.json file
// ============================================================

export interface SyncAttachmentFile {
  sha256: string;
  filename: string;
  mime: string;
  size_bytes: number;
}

// ============================================================
// Path helpers
// ============================================================

/** Directory holding per-sha attachment metadata JSON files. */
export function attachmentSyncDir(syncDir: string): string {
  return join(syncDir, 'attachments');
}

/** Directory holding the actual attachment bytes (git-committed, content-addressed). */
export function attachmentBytesDir(syncDir: string): string {
  // syncDir === <kgDir>/sync → bytes live at <kgDir>/attachments
  return join(dirname(syncDir), 'attachments');
}

/** Locate the on-disk bytes file for a sha (any allowed ext). Returns abs path or null. */
export function findBytesFile(bytesDir: string, sha256: string): string | null {
  if (!existsSync(bytesDir)) return null;
  for (const name of readdirSync(bytesDir)) {
    if (name.startsWith('.tmp-')) continue;
    if (name.startsWith(`${sha256}.`)) return join(bytesDir, name);
  }
  return null;
}

// ============================================================
// Export
// ============================================================

/**
 * Write one Attachment row's byte metadata to sync/attachments/<sha256>.json.
 * Stable-stringified for clean git diffs. Idempotent — same content each time.
 */
export function exportAttachment(row: AttachmentRow, syncDir: string): void {
  const dir = attachmentSyncDir(syncDir);
  mkdirSync(dir, { recursive: true });
  const payload: SyncAttachmentFile = {
    sha256: row.sha256,
    filename: row.filename,
    mime: row.mime,
    size_bytes: row.size_bytes,
  };
  const filePath = join(dir, `${row.sha256}.json`);
  writeFileSync(filePath, stableStringify(payload) + '\n', 'utf-8');
}

/**
 * Remove the sync JSON for a sha (called when the last ref is GC'd).
 */
export function removeAttachmentSyncFile(sha256: string, syncDir: string): void {
  const filePath = join(attachmentSyncDir(syncDir), `${sha256}.json`);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch (e) {
      log('removeAttachmentSyncFile: failed to unlink', filePath, e);
    }
  }
}

// ============================================================
// Import (rebuild rows + delete-by-absence)
// ============================================================

export interface AttachmentImportResult {
  new_rows: number;
  deleted_rows: number;
  gc_bytes: number;
}

/**
 * Rebuild Attachment rows from sync/attachments/*.json, then apply delete-by-absence.
 *
 * 1. For every remote JSON: create the Attachment row if it does not already exist
 *    (rows are immutable byte metadata → never overwrite).
 * 2. Delete-by-absence ([6/15/20]): a LOCAL row whose sha has NO remote JSON means a
 *    teammate GC'd it. Mirror the chunk delete-by-absence (import.ts:160-173): drop the
 *    row and ref-count-GC its bytes (only when no local chunk still references the sha,
 *    so a still-live local linkage is never silently broken).
 *
 * Order-independent w.r.t. chunk import: linkage is lazy (parsed from the chunk's
 * attachment_refs at read time), so importing rows before or after chunks is fine.
 */
export async function importAttachments(
  syncDir: string,
  storage: IStorage,
): Promise<AttachmentImportResult> {
  const result: AttachmentImportResult = { new_rows: 0, deleted_rows: 0, gc_bytes: 0 };
  const dir = attachmentSyncDir(syncDir);
  const bytesDir = attachmentBytesDir(syncDir);

  // 1. Read all remote attachment metadata files.
  const remoteShas = new Set<string>();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const sha = file.replace(/\.json$/, '');
      remoteShas.add(sha);

      const existing = await storage.getAttachment(sha);
      if (existing) continue; // immutable — never overwrite

      // Parse the JSON payload for filename/mime/size.
      let payload: SyncAttachmentFile | null = null;
      try {
        payload = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as SyncAttachmentFile;
      } catch (e) {
        log('importAttachments: failed to parse', file, e);
      }
      if (!payload) continue;

      await storage.createAttachment({
        sha256: payload.sha256 || sha,
        filename: payload.filename ?? '',
        mime: payload.mime ?? '',
        size_bytes: payload.size_bytes ?? 0,
      });
      result.new_rows++;
    }
  }

  // 2. Delete-by-absence: local rows with no remote JSON.
  const localRows = await storage.listAttachments({});
  for (const row of localRows) {
    if (remoteShas.has(row.sha256)) continue;
    // Ref-count GC: only remove if no local chunk still references this sha.
    const refs = await storage.countAttachmentRefs(row.sha256);
    if (refs > 0) continue; // still live locally — keep row + bytes
    await storage.deleteAttachment(row.sha256);
    result.deleted_rows++;
    const bytesPath = findBytesFile(bytesDir, row.sha256);
    if (bytesPath) {
      try {
        unlinkSync(bytesPath);
        result.gc_bytes++;
      } catch (e) {
        log('importAttachments: failed to unlink orphan bytes', bytesPath, e);
      }
    }
    log(`importAttachments: delete-by-absence removed row ${row.sha256.slice(0, 12)}… (0 refs)`);
  }

  return result;
}

// ============================================================
// Byte GC (shared by knowledge_delete [11] and import chunk-deletion [11])
// ============================================================

/**
 * After a chunk that referenced these shas is deleted, GC each sha whose ref-count has
 * dropped to zero: delete the Attachment row, the on-disk bytes, and the sync JSON.
 *
 * `refs` may be raw "<sha256>|<caption>" strings or bare shas — both are handled.
 * Call this AFTER the chunk (and its attachment_refs) are gone so countAttachmentRefs
 * reflects the post-deletion state.
 */
export async function gcOrphanBytesForRefs(
  storage: IStorage,
  syncDir: string,
  refs: string[],
): Promise<{ rows_deleted: number; bytes_deleted: number }> {
  const bytesDir = attachmentBytesDir(syncDir);
  let rowsDeleted = 0;
  let bytesDeleted = 0;

  const seen = new Set<string>();
  for (const ref of refs ?? []) {
    const idx = ref.indexOf('|');
    const sha = idx === -1 ? ref : ref.slice(0, idx);
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);

    const remaining = await storage.countAttachmentRefs(sha);
    if (remaining > 0) continue; // still referenced elsewhere — keep

    const row = await storage.getAttachment(sha);
    if (row) {
      await storage.deleteAttachment(sha);
      rowsDeleted++;
    }
    const bytesPath = findBytesFile(bytesDir, sha);
    if (bytesPath) {
      try {
        unlinkSync(bytesPath);
        bytesDeleted++;
      } catch (e) {
        log('gcOrphanBytesForRefs: failed to unlink bytes', bytesPath, e);
      }
    }
    removeAttachmentSyncFile(sha, syncDir);
    log(`gcOrphanBytesForRefs: GC'd orphan attachment ${sha.slice(0, 12)}… (0 refs)`);
  }

  return { rows_deleted: rowsDeleted, bytes_deleted: bytesDeleted };
}
