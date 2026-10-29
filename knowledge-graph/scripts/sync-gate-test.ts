#!/usr/bin/env npx tsx

/**
 * Sync import gate + importer robustness test (source, temp KuzuDB, no Ollama).
 *
 * A. The daemon's own exports must not trip the import gate (they did: every restart
 *    and every knowledge_* call past the 30s cooldown ran a full importAll over ~3000
 *    files), while a real git pull still must — modified file, new file, deleted file.
 * B. A sync chunk file WITHOUT a `sync_id` field (hand-written) must import exactly once,
 *    keyed by its filename, and its wrong content_hash must not re-update it every time. It used to create a new no-sync_id chunk on EVERY import
 *    (2783 copies of one chunk in upcoz-mobile).
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, utimesSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createStorage, type IStorage } from '../src/storage/interface.js';
import { EMBEDDING_DIMENSIONS } from '../src/types.js';
import { createAutoExporter } from '../src/sync/auto-export.js';
import { exportAll } from '../src/sync/export.js';
import { importAll } from '../src/sync/import.js';
import { checkForNewerSyncFiles } from '../src/sync/sync-gate.js';
import { computeContentHash, type SyncManifest } from '../src/sync/format.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.error(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZERO = new Array(EMBEDDING_DIMENSIONS).fill(0);
// importAll only embeds new/changed chunks; count calls to prove a no-op import embeds nothing.
let embedCalls = 0;
const embedder = { embed: async () => { embedCalls++; return ZERO; } } as any;
const linker = { relinkChunk: async () => [] } as any;

function manifest(syncDir: string): SyncManifest {
  return JSON.parse(readFileSync(join(syncDir, 'manifest.json'), 'utf-8'));
}
function gate(syncDir: string): boolean {
  const m = manifest(syncDir);
  return checkForNewerSyncFiles(syncDir, m.last_import_at, m.self_writes);
}

async function seedChunk(storage: IStorage, id: string): Promise<void> {
  await storage.createChunk({
    id, sync_id: `sync-${id}`, content: `content of ${id}`, summary: `summary ${id}`,
    embedding: ZERO, source: null, category: 'fact', domain: 'test', importance: 'medium',
    layer: 'core-knowledge', keywords: ['gate'], entities: [], tags: [], version: 1,
    confidence: 0.5, validation_count: 0, refutation_count: 0, last_validated_at: '',
    lifecycle: 'active', access_count: 0,
  } as any);
}

async function partA(storage: IStorage, syncDir: string): Promise<void> {
  console.error('\n📋 Part A: import gate vs own exports and real pulls');
  for (const id of ['c1', 'c2', 'c3']) await seedChunk(storage, id);

  await exportAll(storage, syncDir);
  assert(gate(syncDir) === false, 'after our own full export (never imported) the gate stays closed');
  const noLedger = manifest(syncDir);
  assert(checkForNewerSyncFiles(syncDir, noLedger.last_import_at) === true, 'same tree WITHOUT the ledger → gate opens (old behaviour, the bug)');

  // Baseline import: everything matches the DB → no embedding, ledger reset.
  embedCalls = 0;
  const r0 = await importAll(syncDir, storage, embedder, linker, {} as any);
  assert(r0.new_chunks === 0 && r0.updated_chunks === 0 && embedCalls === 0, 'baseline import is a no-op', JSON.stringify(r0));
  assert(manifest(syncDir).self_writes === undefined, 'importAll resets the self-write ledger');
  assert(gate(syncDir) === false, 'right after an import the gate is closed');

  await sleep(30);
  const exporter = createAutoExporter(storage, syncDir);
  await storage.updateChunk('c1', { summary: 'summary c1 v2' });
  exporter.queueChunkExport('c1');
  exporter.queueEdgeRefresh();
  await exporter.flush();
  exporter.destroy();
  assert(gate(syncDir) === false, 'AutoExporter writes (chunk + edge refresh) do NOT open the gate — the restart case');

  // Simulated git pull #1: a file we exported gets new content from a teammate.
  await sleep(30);
  const c2Path = join(syncDir, 'chunks', 'sync-c2.json');
  const c2 = JSON.parse(readFileSync(c2Path, 'utf-8'));
  c2.summary = 'teammate edit';
  writeFileSync(c2Path, JSON.stringify(c2));
  assert(gate(syncDir) === true, 'pulled modification of an existing file opens the gate');
  await importAll(syncDir, storage, embedder, linker, {} as any);
  assert((await storage.getChunk('c2'))?.summary === 'teammate edit', 'and the import applies it');
  assert(gate(syncDir) === false, 'gate closed again after that import');

  // Simulated git pull #2: a brand-new file.
  await sleep(30);
  writeFileSync(join(syncDir, 'chunks', 'sync-new.json'), JSON.stringify({
    ...c2, sync_id: 'sync-new', content: 'pulled new chunk', content_hash: computeContentHash('pulled new chunk'), summary: 'pulled',
  }));
  assert(gate(syncDir) === true, 'pulled NEW file opens the gate');
  await importAll(syncDir, storage, embedder, linker, {} as any);

  // Simulated git pull #3: a deletion only (no file is newer — only the dir changes).
  await sleep(30);
  unlinkSync(join(syncDir, 'chunks', 'sync-c3.json'));
  assert(gate(syncDir) === true, 'pulled DELETION opens the gate (subdir mtime)');
  const rDel = await importAll(syncDir, storage, embedder, linker, {} as any);
  assert(rDel.deleted_chunks === 1 && (await storage.getChunk('c3')) === null, 'and the import deletes the chunk', JSON.stringify(rDel));

  // A pull that rewrites a file with an mtime equal to nothing we recorded.
  await sleep(30);
  const exporter2 = createAutoExporter(storage, syncDir);
  exporter2.queueChunkExport('c1');
  await exporter2.flush();
  exporter2.destroy();
  const c1Path = join(syncDir, 'chunks', 'sync-c1.json');
  const future = new Date(Date.now() + 5_000);
  utimesSync(c1Path, future, future);
  assert(gate(syncDir) === true, 'own export later touched by a pull (mtime differs from the ledger) opens the gate');
}

async function partB(storage: IStorage, syncDir: string): Promise<void> {
  console.error('\n📋 Part B: sync chunk file without a sync_id field');
  const fileId = '65daefe9-dc63-49ee-a148-7006b00ff140';
  const content = 'Hand-written rule with no sync_id field.';
  writeFileSync(join(syncDir, 'chunks', `${fileId}.json`), JSON.stringify({
    // Wrong content_hash on purpose — the live hand-written file had one too.
    category: 'rule', content, content_hash: 'sha256:e34c8274832a7575605e0a4a268354764c43370163807e7fbd2b0acfa24d76f6', created_at: '2026-04-20T10:07:03.000Z',
    domain: 'test', entities: [], importance: 'critical', keywords: ['handwritten'], layer: 'core-knowledge',
    lifecycle: 'active', source: 'user-confirmed:test', summary: 'hand-written', tags: [], updated_at: '2026-04-20T10:07:03.000Z', version: 1,
  }));
  writeFileSync(join(syncDir, 'chunks', 'no-content.json'), JSON.stringify({ sync_id: 'no-content', summary: 'broken' }));

  const before = (await storage.listChunks({}, 1000)).length;
  const r1 = await importAll(syncDir, storage, embedder, linker, {} as any);
  const r2 = await importAll(syncDir, storage, embedder, linker, {} as any);
  const r3 = await importAll(syncDir, storage, embedder, linker, {} as any);
  const all = await storage.listChunks({}, 1000);
  const copies = all.filter((c) => c.content === content);
  assert(r1.new_chunks === 1 && r2.new_chunks === 0 && r3.new_chunks === 0, 'imported once, then never again', `${r1.new_chunks}/${r2.new_chunks}/${r3.new_chunks}`);
  assert(copies.length === 1, 'exactly one chunk for the file after 3 imports', `copies=${copies.length}`);
  assert(r2.updated_chunks === 0 && r3.updated_chunks === 0, 'a wrong content_hash in the file does not cause a re-embed/update every import', `${r2.updated_chunks}/${r3.updated_chunks}`);
  assert(copies[0]?.sync_id === fileId, 'its sync_id is the filename', `sync_id=${copies[0]?.sync_id}`);
  assert(all.length === before + 1, 'the no-content file is skipped (no chunk created)', `before=${before} after=${all.length}`);
  assert(!all.some((c) => !c.sync_id), 'no chunk without a sync_id exists');

  unlinkSync(join(syncDir, 'chunks', `${fileId}.json`));
  const r4 = await importAll(syncDir, storage, embedder, linker, {} as any);
  assert(r4.deleted_chunks === 1, 'deleting that file now deletes its chunk (was impossible with sync_id undefined)', JSON.stringify(r4));
}

async function main(): Promise<void> {
  console.error('🧪 Sync gate + importer test');
  console.error('═'.repeat(50));
  const dir = mkdtempSync(join(tmpdir(), 'kg-sync-gate-'));
  const syncDir = join(dir, 'sync');
  mkdirSync(syncDir, { recursive: true });
  const storage = await createStorage('kuzu', join(dir, 'data', 'knowledge'));
  try {
    await partA(storage, syncDir);
    await partB(storage, syncDir);
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
  console.error('═'.repeat(50));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
