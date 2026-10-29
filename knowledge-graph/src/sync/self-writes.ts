import { join } from 'path';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { log } from '../types.js';
import type { SelfWrites, SyncManifest } from './format.js';

/**
 * Self-write ledger: which sync files THIS machine's daemon wrote since the last import.
 *
 * Why: the import gate (sync-gate.ts) asks "is any sync file newer than last_import_at?".
 * The daemon's own AutoExporter writes sync files after every mutation (and rewrites ALL
 * edge files on every link), so the answer was always yes — every restart, and every
 * knowledge_* call past the 30s cooldown, ran a full importAll over ~3000 files (40-130s
 * under the RPC mutex) just to re-read what it had written itself.
 *
 * The ledger records, per written file, the mtime it had right after our write, plus the
 * mtime of each sync subdir (adds/removes change it). The gate skips a file whose mtime
 * still equals the recorded one; anything else newer than the last import — a file a git
 * pull created or modified, a file or dir changed by hand, a file a pull deleted (dir
 * mtime moved) — still triggers the import. Unrecorded writes err on the safe side
 * (import), exactly like before.
 *
 * Stored in manifest.json (gitignored, per machine — mtimes mean nothing elsewhere) under
 * `self_writes`; importAll resets it, since after an import every file has been seen.
 */

export const SYNC_SUBDIRS = ['chunks', 'edges', 'attachments'] as const;

function readManifest(manifestPath: string): Partial<SyncManifest> {
  if (!existsSync(manifestPath)) return {};
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<SyncManifest>;
  } catch {
    return {};
  }
}

/**
 * Merge freshly written (or removed) files into `prev`: each path present on disk gets its
 * current mtime, each missing path is dropped; every existing subdir's mtime is refreshed.
 * Call it right AFTER the writes, so the recorded mtimes are the ones the gate will see.
 */
export function captureSelfWrites(syncDir: string, relPaths: Iterable<string>, prev?: SelfWrites): SelfWrites {
  const files: Record<string, number> = { ...(prev?.files ?? {}) };
  for (const rel of relPaths) {
    try {
      files[rel] = statSync(join(syncDir, rel)).mtimeMs;
    } catch {
      delete files[rel];
    }
  }
  const dirs: Record<string, number> = { ...(prev?.dirs ?? {}) };
  for (const sub of SYNC_SUBDIRS) {
    try {
      dirs[sub] = statSync(join(syncDir, sub)).mtimeMs;
    } catch {
      delete dirs[sub];
    }
  }
  return { files, dirs };
}

/**
 * Record self-writes into manifest.json, preserving every other manifest field.
 * `extra` overrides manifest fields in the same write (the AutoExporter passes counts +
 * last_export_at). Never throws — a failed record only costs one extra import.
 */
export function recordSelfWrites(syncDir: string, relPaths: Iterable<string>, extra: Partial<SyncManifest> = {}): void {
  const manifestPath = join(syncDir, 'manifest.json');
  try {
    const existing = readManifest(manifestPath);
    const manifest: SyncManifest = {
      format_version: existing.format_version || 1,
      last_export_at: existing.last_export_at || '',
      last_import_at: existing.last_import_at || '',
      chunk_count: existing.chunk_count ?? 0,
      edge_count: existing.edge_count ?? 0,
      ...extra,
      self_writes: captureSelfWrites(syncDir, relPaths, existing.self_writes),
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  } catch (e) {
    log('recordSelfWrites: failed (next gate check will import once):', e);
  }
}

export function chunkRelPath(syncId: string): string {
  return `chunks/${syncId}.json`;
}
