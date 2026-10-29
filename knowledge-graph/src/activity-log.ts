import { appendFileSync, renameSync, statSync } from 'fs';

/**
 * `.knowledge-graph/activity.log` — local JSONL session analytics (per machine,
 * never synced). Writers: `kg prime` (session_start, this module) and
 * the hook scripts installed by scripts/setup-hooks.sh (kg-activity-tracker.sh: one
 * line per tool call; kg-learning-capture-check.sh: `turn_stop`, one line per Stop
 * hook = per assistant turn). It had no rotation and reached 62 MB in 7 months.
 *
 * Rotation is size-based and keeps ONE previous file: above the cap the log is
 * renamed to activity.log.1 (replacing the old .1), so at most ~2x the cap stays on
 * disk. The bash hooks apply the same rule with the same env override.
 */

export const ACTIVITY_LOG_MAX_BYTES_DEFAULT = 5 * 1024 * 1024;

export function activityLogMaxBytes(): number {
  const n = parseInt(process.env.KG_ACTIVITY_LOG_MAX_BYTES || '', 10);
  return Number.isFinite(n) && n > 0 ? n : ACTIVITY_LOG_MAX_BYTES_DEFAULT;
}

/** Rename `path` to `path.1` when it is larger than `maxBytes`. Returns true if rotated. */
export function rotateIfLarge(path: string, maxBytes: number = activityLogMaxBytes()): boolean {
  try {
    if (statSync(path).size <= maxBytes) return false;
    renameSync(path, `${path}.1`);
    return true;
  } catch {
    return false; // missing file or a concurrent rotation by a hook — nothing to do
  }
}

/** Append one JSONL entry, rotating first if the file is over the cap. */
export function appendActivity(path: string, entry: Record<string, unknown>): void {
  rotateIfLarge(path);
  appendFileSync(path, JSON.stringify(entry) + '\n');
}
