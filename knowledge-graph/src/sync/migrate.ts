import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { IStorage } from '../storage/interface.js';
import { log } from '../types.js';
import { exportAll } from './export.js';

// ============================================================
// Migration result
// ============================================================

export interface MigrationResult {
  backfilled_sync_ids: number;
  exported_chunks: number;
  exported_edges: number;
}

// ============================================================
// v1 -> v2 migration
// ============================================================

/**
 * Migrate a v1 knowledge graph to v2 (team sync support).
 *
 * 1. Backfill sync_ids: find all chunks with empty sync_id, generate UUID for each
 * 2. Create sync directory structure if not exists
 * 3. Full export of all chunks and manual edges to sync/
 * 4. Bump config.json version to 2
 * 5. Log migration results and return counts
 */
export async function migrateV1toV2(
  storage: IStorage,
  syncDir: string,
  projectConfigPath: string,
): Promise<MigrationResult> {
  log('Migration v1->v2: starting...');

  // 1. Backfill sync_ids
  const backfilled = await backfillSyncIds(storage);
  log(`Migration v1->v2: backfilled ${backfilled} sync_ids`);

  // 2. Create sync directory structure if not exists
  mkdirSync(join(syncDir, 'chunks'), { recursive: true });
  mkdirSync(join(syncDir, 'edges'), { recursive: true });

  // 3. Full export
  const exportResult = await exportAll(storage, syncDir);
  log(`Migration v1->v2: exported ${exportResult.chunks} chunks, ${exportResult.edges} edges`);

  // 4. Bump config version to 2
  bumpConfigVersion(projectConfigPath, 2);
  log('Migration v1->v2: bumped config version to 2');

  const result: MigrationResult = {
    backfilled_sync_ids: backfilled,
    exported_chunks: exportResult.chunks,
    exported_edges: exportResult.edges,
  };

  log(`Migration v1->v2 complete: ${JSON.stringify(result)}`);
  return result;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Find all chunks with empty sync_id and assign a UUID.
 * Returns the count of chunks backfilled.
 */
async function backfillSyncIds(storage: IStorage): Promise<number> {
  const allChunks = await storage.listChunks({}, 10000);
  let count = 0;

  for (const chunk of allChunks) {
    if (!chunk.sync_id || chunk.sync_id === '') {
      const syncId = randomUUID();
      await storage.updateChunk(chunk.id, { sync_id: syncId });
      count++;
    }
  }

  return count;
}

/**
 * Read config.json, set version to newVersion, write back.
 */
function bumpConfigVersion(configPath: string, newVersion: number): void {
  if (!existsSync(configPath)) {
    log(`Migration: config file not found at ${configPath}, skipping version bump`);
    return;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw);
  config.version = newVersion;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
