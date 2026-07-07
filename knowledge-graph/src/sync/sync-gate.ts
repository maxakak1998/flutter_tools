import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';

/**
 * Decide whether a delta import should run: are there any sync files newer than the
 * last import? Returns true when import is warranted (or when lastImportAt is empty —
 * we have never imported and files exist).
 *
 * Scans three subdirs: chunks/, edges/, and attachments/. The attachments/ scan is
 * [18]: an attachment-only pull (a commit that only adds/removes
 * sync/attachments/<sha>.json, touching no chunk) must still trigger import, or
 * teammates get the committed bytes but never the Attachment ROW that indexes them.
 */
export function checkForNewerSyncFiles(syncDir: string, lastImportAt: string): boolean {
  // Never imported before → import if any chunk OR attachment file exists.
  if (!lastImportAt) {
    for (const sub of ['chunks', 'attachments']) {
      const dir = join(syncDir, sub);
      if (existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith('.json')).length > 0) {
        return true;
      }
    }
    return false;
  }

  const importTime = new Date(lastImportAt).getTime();
  if (isNaN(importTime)) return true; // Invalid date → be safe and import.

  // Any file across chunks/, edges/, attachments/ with mtime after the last import wins.
  for (const sub of ['chunks', 'edges', 'attachments']) {
    const dir = join(syncDir, sub);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        if (statSync(join(dir, file)).mtimeMs > importTime) return true;
      } catch {
        /* ignore individual file errors */
      }
    }
  }

  return false;
}
