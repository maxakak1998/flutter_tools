import { StoredChunk } from '../types.js';
import { SyncChunkFile, LifecycleConflict } from './format.js';

// ============================================================
// Lifecycle conflict detection
// ============================================================

/**
 * Detect a lifecycle conflict between a local chunk and a remote sync file.
 *
 * - If same lifecycle -> null (no conflict)
 * - If different -> return LifecycleConflict for human resolution
 *
 * Lifecycle conflicts are blocking: the affected chunk is skipped during import
 * and must be resolved via `kg sync resolve`.
 */
export function detectLifecycleConflict(
  local: StoredChunk,
  remote: SyncChunkFile,
): LifecycleConflict | null {
  if (local.lifecycle === remote.lifecycle) {
    return null;
  }

  return {
    sync_id: remote.sync_id,
    summary: remote.summary,
    local_lifecycle: local.lifecycle,
    remote_lifecycle: remote.lifecycle,
    local_updated: local.updated_at,
    remote_updated: remote.updated_at,
  };
}

// ============================================================
// Display confidence mapping
// ============================================================

/**
 * Map a lifecycle state to a display confidence value.
 * Used for UI presentation when no actual confidence is available.
 */
export function deriveDisplayConfidence(lifecycle: string): number {
  switch (lifecycle) {
    case 'hypothesis': return 0.3;
    case 'active': return 0.5;
    case 'validated': return 0.8;
    case 'promoted': return 0.9;
    case 'canonical': return 0.95;
    case 'refuted': return 0.05;
    default: return 0.5;
  }
}

// ============================================================
// Conflict report formatting
// ============================================================

/**
 * Format a box-styled conflict report for terminal display.
 * This report is unsuppressible — lifecycle conflicts must be resolved by a human.
 */
export function formatConflictReport(conflicts: LifecycleConflict[]): string {
  if (conflicts.length === 0) return '';

  const lines: string[] = [];
  const width = 55;
  const hr = '\u2500'.repeat(width);

  lines.push(`\u250C${hr}\u2510`);
  lines.push(`\u2502 ${'LIFECYCLE CONFLICT \u2014 requires human resolution'.padEnd(width - 1)}\u2502`);
  lines.push(`\u251C${hr}\u2524`);

  for (let i = 0; i < conflicts.length; i++) {
    const c = conflicts[i];
    const truncSummary = c.summary.length > 30
      ? c.summary.slice(0, 27) + '...'
      : c.summary;
    const shortId = c.sync_id.length > 8
      ? c.sync_id.slice(0, 8)
      : c.sync_id;

    const localDate = c.local_updated.slice(0, 10);
    const remoteDate = c.remote_updated.slice(0, 10);

    lines.push(`\u2502 ${`chunk ${shortId} "${truncSummary}"`.padEnd(width - 1)}\u2502`);
    lines.push(`\u2502 ${`  local:  ${c.local_lifecycle.padEnd(12)} (${localDate})`.padEnd(width - 1)}\u2502`);
    lines.push(`\u2502 ${`  remote: ${c.remote_lifecycle.padEnd(12)} (${remoteDate})`.padEnd(width - 1)}\u2502`);
    lines.push(`\u2502 ${' '.repeat(width - 1)}\u2502`);
    lines.push(`\u2502 ${`\u2192 kg sync resolve ${shortId} keep-local`.padEnd(width - 1)}\u2502`);
    lines.push(`\u2502 ${`\u2192 kg sync resolve ${shortId} accept-remote`.padEnd(width - 1)}\u2502`);

    if (i < conflicts.length - 1) {
      lines.push(`\u2502 ${' '.repeat(width - 1)}\u2502`);
    }
  }

  lines.push(`\u2514${hr}\u2518`);

  return lines.join('\n');
}
