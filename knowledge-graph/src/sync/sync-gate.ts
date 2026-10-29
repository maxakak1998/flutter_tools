import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import type { SelfWrites } from './format.js';
import { SYNC_SUBDIRS } from './self-writes.js';

/**
 * Decide whether a delta import should run: are there sync changes this machine has not
 * imported yet? Returns true when import is warranted.
 *
 * A file counts as a change when its mtime is after `lastImportAt` (empty = never
 * imported: every file counts) AND it is not one of our own exports — i.e. its mtime
 * differs from the one recorded in `selfWrites` (see sync/self-writes.ts). Without the
 * ledger the daemon's own AutoExporter writes tripped this gate on every restart.
 * A subdir whose mtime moved past the last import without matching the ledger also
 * counts: that is how a pull that only DELETES sync files shows up.
 *
 * Scans chunks/, edges/ and attachments/. The attachments/ scan is [18]: an
 * attachment-only pull (a commit that only adds/removes sync/attachments/<sha>.json,
 * touching no chunk) must still trigger import, or teammates get the committed bytes but
 * never the Attachment ROW that indexes them.
 */
export function checkForNewerSyncFiles(syncDir: string, lastImportAt: string, selfWrites?: SelfWrites): boolean {
  const importTime = lastImportAt ? new Date(lastImportAt).getTime() : 0;
  if (isNaN(importTime)) return true; // Invalid date → be safe and import.
  const ownFiles = selfWrites?.files ?? {};
  const ownDirs = selfWrites?.dirs ?? {};

  for (const sub of SYNC_SUBDIRS) {
    const dir = join(syncDir, sub);
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    // importTime 0 (never imported) → every file counts, unless it is our own export
    // (e.g. right after the v1→v2 migration's full export).
    for (const file of files) {
      const rel = `${sub}/${file}`;
      try {
        const mtime = statSync(join(dir, file)).mtimeMs;
        if (mtime > importTime && ownFiles[rel] !== mtime) return true;
      } catch {
        /* ignore individual file errors */
      }
    }
    if (importTime > 0) {
      try {
        const dirMtime = statSync(dir).mtimeMs;
        if (dirMtime > importTime && ownDirs[sub] !== dirMtime) return true;
      } catch {
        /* ignore */
      }
    }
  }

  return false;
}
