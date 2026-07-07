#!/usr/bin/env npx tsx

/**
 * Phase 3 verify — Attachment SYNC (field-carry + attachment-sync + gate + cascade + merge).
 *
 * This is the heaviest phase — it proves evidence survives git → another machine.
 * Runs on the default backend (kuzu — hard gate). Requires Ollama (chunks embed on
 * import). Uses temp dirs, cleans up after.
 *
 *  1. ROUND-TRIP (Defect A field-carry): add attachment → export chunk + attachment →
 *     WIPE the DB → import → chunk.attachment_refs, the Attachment row, and the on-disk
 *     bytes are ALL rebuilt. (If format.ts/export.ts dropped attachment_refs, the ref is
 *     gone after re-import and this fails.)
 *  2. [6/15/20] DELETE-BY-ABSENCE: a local Attachment row whose sha has NO remote sync
 *     JSON (and 0 chunk refs) is removed on import, and its orphan bytes are GC'd.
 *  3. [19] CROSS-MACHINE MERGE: two chunk sync files reference the SAME sha → import
 *     yields 1 Attachment row and 2 refs (no linkage lost, no last-writer-wins).
 *  3b.[19] SET-UNION on same chunk: local ref + remote ref for the same chunk on two
 *     different shas both survive re-import (union, not overwrite).
 *  4. [11] CASCADE: (a) knowledge_delete of the last referrer GC's row + bytes;
 *     (b) import-delete (teammate removed the chunk) GC's the now-orphaned attachment.
 *  5. [18] GATE: checkForNewerSyncFiles returns true when ONLY a new file exists under
 *     sync/attachments/ (attachment-only pull), on both the empty-lastImport and the
 *     mtime path.
 */

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  utimesSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createStorage, IStorage } from '../src/storage/interface.js';
import { Embedder } from '../src/engine/embedder.js';
import { Linker } from '../src/engine/linker.js';
import { loadConfig } from '../src/config.js';
import { StoredChunk } from '../src/types.js';
import { handleAttachmentAdd } from '../src/tools/attachment.js';
import { handleDelete } from '../src/tools/delete.js';
import { exportAll } from '../src/sync/export.js';
import { importAll } from '../src/sync/import.js';
import {
  exportAttachment,
  attachmentBytesDir,
  attachmentSyncDir,
  findBytesFile,
} from '../src/sync/attachment-sync.js';
import { checkForNewerSyncFiles } from '../src/sync/sync-gate.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.error(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const cfg = loadConfig();
const embedder = new Embedder(cfg.ollama.url, cfg.ollama.model, cfg.cache.embeddingCacheSize);

function pngBytes(salt: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`fake-png-payload-${salt}-${'x'.repeat(64)}`),
  ]);
}

function makeChunk(id: string, content: string, embedding: number[]): Omit<StoredChunk, 'created_at' | 'updated_at' | 'issue_ref' | 'issue_status' | 'issue_priority' | 'blocked_by' | 'attachment_refs'> {
  return {
    id, sync_id: id, content, summary: content.slice(0, 60), embedding, source: null,
    category: 'fact', domain: 'attachment-p3', importance: 'medium', layer: 'core-knowledge',
    keywords: ['attachment', 'evidence', 'sync'], entities: [], tags: [], version: 1,
    confidence: 0.5, validation_count: 0, refutation_count: 0, last_validated_at: '',
    lifecycle: 'active', access_count: 0,
  };
}

/** Fresh temp KG dir with the attachments/ + sync/{chunks,edges,attachments} skeleton. */
function makeKgDir(): { kgDir: string; syncDir: string; dbPath: string; attachmentsDir: string } {
  const kgDir = mkdtempSync(join(tmpdir(), 'kg-attach-p3-'));
  const syncDir = join(kgDir, 'sync');
  mkdirSync(join(kgDir, 'attachments'), { recursive: true });
  mkdirSync(join(syncDir, 'chunks'), { recursive: true });
  mkdirSync(join(syncDir, 'edges'), { recursive: true });
  mkdirSync(join(syncDir, 'attachments'), { recursive: true });
  return { kgDir, syncDir, dbPath: join(kgDir, 'db'), attachmentsDir: join(kgDir, 'attachments') };
}

async function open(dbPath: string): Promise<{ storage: IStorage; linker: Linker }> {
  const storage = await createStorage('kuzu', dbPath);
  const linker = new Linker(storage, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK);
  return { storage, linker };
}

// ============================================================
// Test 1 — round-trip (Defect A field-carry)
// ============================================================
async function testRoundTrip() {
  console.error('\n📋 Test 1: round-trip — export → WIPE DB → import → refs+row+bytes intact');
  const { syncDir, dbPath, attachmentsDir } = makeKgDir();
  const kgDir = join(dbPath, '..');
  let { storage } = await open(dbPath);
  try {
    const emb = await embedder.embed('force-update dialog wrong copy — evidence screenshot');
    const id = randomUUID();
    await storage.createChunk(makeChunk(id, 'Force-update dialog shows wrong copy in VN locale.', emb));

    const srcDir = mkdtempSync(join(tmpdir(), 'kg-attach-src-'));
    const srcPath = join(srcDir, '30_force.png');
    writeFileSync(srcPath, pngBytes(1));
    const add = await handleAttachmentAdd(storage, kgDir, { source: srcPath, attach_to: { chunk_id: id }, caption: 'Force EN' });

    // Export everything (chunks + manifest) then the attachment byte-metadata JSON.
    await exportAll(storage, syncDir);
    const row = await storage.getAttachment(add.sha256);
    exportAttachment(row!, syncDir);
    assert(existsSync(join(attachmentSyncDir(syncDir), `${add.sha256}.json`)), 'sync/attachments/<sha>.json written on export');

    const chunkFile = join(syncDir, 'chunks', `${id}.json`);
    const raw = readFileSync(chunkFile, 'utf-8');
    assert(/attachment_refs/.test(raw) && raw.includes(add.sha256), 'chunk sync file carries attachment_refs (field-carry)', raw.includes(add.sha256) ? '' : 'sha missing in chunk json');

    // WIPE the DB (bytes + sync files survive — simulates a fresh clone).
    await storage.close();
    rmSync(dbPath, { recursive: true, force: true });
    assert(existsSync(join(attachmentsDir, `${add.sha256}.png`)), 'bytes survive DB wipe (git-committed content store)');

    ({ storage } = await open(dbPath));
    const linker = new Linker(storage, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK);
    const imp = await importAll(syncDir, storage, embedder, linker, cfg);
    assert(imp.new_chunks === 1, 'import recreated the chunk', String(imp.new_chunks));
    assert(imp.new_attachments === 1, 'import rebuilt the Attachment row', String(imp.new_attachments));

    const chunk = await storage.findChunkBySyncId(id);
    assert((chunk?.attachment_refs ?? []).some((r) => r.startsWith(add.sha256)), 'attachment_refs rebuilt on the chunk', JSON.stringify(chunk?.attachment_refs));
    assert((chunk?.attachment_refs ?? []).includes(`${add.sha256}|Force EN`), 'caption preserved through round-trip');
    const rebuiltRow = await storage.getAttachment(add.sha256);
    assert(rebuiltRow?.mime === 'image/png' && rebuiltRow?.filename === '30_force.png', 'Attachment row metadata rebuilt', JSON.stringify(rebuiltRow));
    assert(findBytesFile(attachmentBytesDir(syncDir), add.sha256) !== null, 'bytes still present after import');

    rmSync(srcDir, { recursive: true, force: true });
  } catch (e) {
    console.error(`💥 ${e}`); if (e instanceof Error) console.error(e.stack); failed++;
  } finally {
    try { await storage.close(); } catch { /* ignore */ }
    try { rmSync(kgDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ============================================================
// Test 2 — delete-by-absence [6/15/20]
// ============================================================
async function testDeleteByAbsence() {
  console.error('\n📋 Test 2: delete-by-absence — local row, no remote JSON, 0 refs → row+bytes removed');
  const { syncDir, dbPath, attachmentsDir } = makeKgDir();
  const kgDir = join(dbPath, '..');
  const { storage, linker } = await open(dbPath);
  try {
    // A local Attachment row + bytes with NO chunk referencing it and NO remote json.
    const sha = 'a'.repeat(64);
    await storage.createAttachment({ sha256: sha, filename: 'orphan.png', mime: 'image/png', size_bytes: 10 });
    writeFileSync(join(attachmentsDir, `${sha}.png`), pngBytes(2));
    assert((await storage.getAttachment(sha)) !== null, 'local orphan row exists pre-import');

    // Write a manifest so importAll has state; no chunk files, no attachment json.
    writeFileSync(join(syncDir, 'manifest.json'), JSON.stringify({ format_version: 1, last_export_at: '', last_import_at: '', chunk_count: 0, edge_count: 0 }) + '\n');

    await importAll(syncDir, storage, embedder, linker, cfg);
    assert((await storage.getAttachment(sha)) === null, 'orphan row deleted by absence');
    assert(!existsSync(join(attachmentsDir, `${sha}.png`)), 'orphan bytes GCd by absence');

    // Guard: a row STILL referenced by a chunk must NOT be deleted by absence.
    const emb = await embedder.embed('a chunk that still references its evidence image');
    const id = randomUUID();
    await storage.createChunk(makeChunk(id, 'Still-live evidence chunk.', emb));
    const shaLive = 'b'.repeat(64);
    await storage.createAttachment({ sha256: shaLive, filename: 'live.png', mime: 'image/png', size_bytes: 10 });
    writeFileSync(join(attachmentsDir, `${shaLive}.png`), pngBytes(3));
    await storage.updateChunk(id, { attachment_refs: [`${shaLive}|kept`] });
    // Export the chunk so it is present in remote (not removed by chunk delete-by-absence);
    // deliberately do NOT export shaLive's attachment json — the ref-count guard alone
    // must keep the row alive because the live chunk still references it.
    await exportAll(storage, syncDir);
    await importAll(syncDir, storage, embedder, linker, cfg);
    assert((await storage.getAttachment(shaLive)) !== null, 'still-referenced row survives (ref-count guard)');
    assert(existsSync(join(attachmentsDir, `${shaLive}.png`)), 'still-referenced bytes survive');
  } catch (e) {
    console.error(`💥 ${e}`); if (e instanceof Error) console.error(e.stack); failed++;
  } finally {
    try { await storage.close(); } catch { /* ignore */ }
    try { rmSync(kgDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ============================================================
// Test 3 — cross-machine merge [19]
// ============================================================
async function testCrossMachineMerge() {
  console.error('\n📋 Test 3: two chunk sync files reference the SAME sha → 1 row / 2 refs');
  const { syncDir, dbPath, attachmentsDir } = makeKgDir();
  const kgDir = join(dbPath, '..');
  const { storage, linker } = await open(dbPath);
  try {
    const sha = 'c'.repeat(64);
    // Bytes present (git-committed) + one shared attachment json.
    writeFileSync(join(attachmentsDir, `${sha}.png`), pngBytes(4));
    writeFileSync(join(attachmentSyncDir(syncDir), `${sha}.json`), JSON.stringify({ sha256: sha, filename: 'shared.png', mime: 'image/png', size_bytes: 10 }) + '\n');

    // Two chunk sync files (different chunks) both referencing the same sha.
    const mkChunkJson = (syncId: string, caption: string) => JSON.stringify({
      sync_id: syncId, version: 1, content_hash: 'sha256:x', content: `chunk ${syncId} content unique ${caption}`,
      summary: 's', domain: 'attachment-p3', category: 'fact', importance: 'medium', layer: 'core-knowledge',
      keywords: ['k'], entities: [], tags: [], lifecycle: 'active', source: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      attachment_refs: [`${sha}|${caption}`],
    }) + '\n';
    const idA = randomUUID(), idB = randomUUID();
    writeFileSync(join(syncDir, 'chunks', `${idA}.json`), mkChunkJson(idA, 'from A'));
    writeFileSync(join(syncDir, 'chunks', `${idB}.json`), mkChunkJson(idB, 'from B'));
    writeFileSync(join(syncDir, 'manifest.json'), JSON.stringify({ format_version: 1, last_export_at: '', last_import_at: '', chunk_count: 2, edge_count: 0 }) + '\n');

    const imp = await importAll(syncDir, storage, embedder, linker, cfg);
    assert(imp.new_chunks === 2, 'both chunks imported', String(imp.new_chunks));
    assert((await storage.listAttachments({})).length === 1, 'exactly 1 shared Attachment row');
    assert((await storage.countAttachmentRefs(sha)) === 2, 'countAttachmentRefs === 2 (no linkage lost)');

    // 3b — SET-UNION on the SAME chunk across re-import (local + remote different shas).
    console.error('   ↳ 3b: set-union on the same chunk (local + remote, two shas) both survive');
    const shaLocal = 'd'.repeat(64);
    const localChunk = await storage.findChunkBySyncId(idA);
    await storage.updateChunk(localChunk!.id, { attachment_refs: [`${sha}|from A`, `${shaLocal}|local-only`] });
    // Re-import: remote chunk A json still only has the shared sha. Union must keep BOTH.
    // Bump chunk A json version so it is treated as a metadata update.
    writeFileSync(join(syncDir, 'chunks', `${idA}.json`), JSON.stringify({
      sync_id: idA, version: 2, content_hash: 'sha256:x', content: `chunk ${idA} content unique from A`,
      summary: 's', domain: 'attachment-p3', category: 'fact', importance: 'medium', layer: 'core-knowledge',
      keywords: ['k'], entities: [], tags: [], lifecycle: 'active', source: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      attachment_refs: [`${sha}|from A`],
    }) + '\n');
    await importAll(syncDir, storage, embedder, linker, cfg);
    const merged = await storage.findChunkBySyncId(idA);
    const shas = new Set((merged?.attachment_refs ?? []).map((r) => r.split('|')[0]));
    assert(shas.has(sha) && shas.has(shaLocal), 'union kept BOTH the remote sha and the local-only sha (no overwrite)', JSON.stringify([...shas]));
    assert((merged?.attachment_refs ?? []).length === 2, 'exactly 2 refs after union (deduped)', String(merged?.attachment_refs?.length));
  } catch (e) {
    console.error(`💥 ${e}`); if (e instanceof Error) console.error(e.stack); failed++;
  } finally {
    try { await storage.close(); } catch { /* ignore */ }
    try { rmSync(kgDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ============================================================
// Test 4 — cascade [11] on knowledge_delete AND import-delete
// ============================================================
async function testCascade() {
  console.error('\n📋 Test 4: cascade — knowledge_delete + import-delete GC orphan bytes');
  const { syncDir, dbPath, attachmentsDir } = makeKgDir();
  const kgDir = join(dbPath, '..');
  const { storage, linker } = await open(dbPath);
  const srcDir = mkdtempSync(join(tmpdir(), 'kg-attach-src-'));
  try {
    // (a) knowledge_delete of the sole referrer → row + bytes GC'd.
    const emb = await embedder.embed('chunk that is the only referrer of its evidence');
    const id = randomUUID();
    await storage.createChunk(makeChunk(id, 'Sole-referrer evidence chunk.', emb));
    const srcPath = join(srcDir, 'sole.png');
    writeFileSync(srcPath, pngBytes(5));
    const add = await handleAttachmentAdd(storage, kgDir, { source: srcPath, attach_to: { chunk_id: id }, caption: 'sole' });
    exportAttachment((await storage.getAttachment(add.sha256))!, syncDir);
    assert((await storage.getAttachment(add.sha256)) !== null, 'row present before delete');

    const del = await handleDelete(storage, id, undefined, syncDir);
    assert((del.attachment_gc?.rows_deleted ?? 0) === 1, 'knowledge_delete cascade reports 1 row GC', JSON.stringify(del.attachment_gc));
    assert((await storage.getAttachment(add.sha256)) === null, 'row GCd on knowledge_delete');
    assert(!existsSync(join(attachmentsDir, `${add.sha256}.png`)), 'bytes GCd on knowledge_delete');
    assert(!existsSync(join(attachmentSyncDir(syncDir), `${add.sha256}.json`)), 'attachment sync json removed on knowledge_delete');

    // (b) import-delete: a chunk exists locally + exported, then its sync file vanishes
    //     (teammate deleted the chunk) → import removes chunk AND GC's orphan attachment.
    const emb2 = await embedder.embed('chunk deleted by a teammate, cascading its evidence');
    const id2 = randomUUID();
    await storage.createChunk(makeChunk(id2, 'Teammate-deleted evidence chunk.', emb2));
    const srcPath2 = join(srcDir, 'team.png');
    writeFileSync(srcPath2, pngBytes(6));
    const add2 = await handleAttachmentAdd(storage, kgDir, { source: srcPath2, attach_to: { chunk_id: id2 }, caption: 'team' });
    await exportAll(storage, syncDir);           // writes chunk sync file + manifest
    exportAttachment((await storage.getAttachment(add2.sha256))!, syncDir);
    assert(existsSync(join(syncDir, 'chunks', `${id2}.json`)), 'chunk2 sync file exists after export');

    // Simulate the teammate's deletion: remove the chunk sync file (git pull effect).
    rmSync(join(syncDir, 'chunks', `${id2}.json`));
    const imp = await importAll(syncDir, storage, embedder, linker, cfg);
    assert(imp.deleted_chunks === 1, 'import detected the teammate deletion', String(imp.deleted_chunks));
    assert((imp.deleted_attachments ?? 0) === 1, 'import cascade GC reported 1 attachment row', String(imp.deleted_attachments));
    assert((await storage.findChunkBySyncId(id2)) === null, 'chunk2 removed on import');
    assert((await storage.getAttachment(add2.sha256)) === null, 'orphan attachment row GCd on import-delete');
    assert(!existsSync(join(attachmentsDir, `${add2.sha256}.png`)), 'orphan bytes GCd on import-delete');
  } catch (e) {
    console.error(`💥 ${e}`); if (e instanceof Error) console.error(e.stack); failed++;
  } finally {
    try { await storage.close(); } catch { /* ignore */ }
    try { rmSync(kgDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(srcDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ============================================================
// Test 5 — [18] gate scans sync/attachments/ (pure fs, no DB)
// ============================================================
function testGate() {
  console.error('\n📋 Test 5: [18] checkForNewerSyncFiles trips on an attachment-only pull');
  const { syncDir, kgDir } = (() => { const d = makeKgDir(); return { syncDir: d.syncDir, kgDir: join(d.dbPath, '..') }; })();
  try {
    // 5a — empty lastImportAt: a lone attachment json (no chunk files) must trip the gate.
    writeFileSync(join(attachmentSyncDir(syncDir), `${'e'.repeat(64)}.json`), JSON.stringify({ sha256: 'e'.repeat(64), filename: 'x.png', mime: 'image/png', size_bytes: 1 }) + '\n');
    assert(checkForNewerSyncFiles(syncDir, '') === true, 'empty lastImport + only attachment json → true');

    // 5b — mtime path: lastImport in the past, only the attachment json is newer.
    const past = new Date(Date.now() - 60_000).toISOString();
    // Ensure the attachment json mtime is AFTER `past` (write already stamped it now).
    assert(checkForNewerSyncFiles(syncDir, past) === true, 'past lastImport + newer attachment json → true');

    // 5c — negative: everything older than lastImport → false.
    const older = new Date(Date.now() - 120_000);
    for (const f of readdirSync(attachmentSyncDir(syncDir))) {
      utimesSync(join(attachmentSyncDir(syncDir), f), older, older);
    }
    const future = new Date(Date.now() + 60_000).toISOString();
    assert(checkForNewerSyncFiles(syncDir, future) === false, 'future lastImport + only-older files → false');
  } catch (e) {
    console.error(`💥 ${e}`); if (e instanceof Error) console.error(e.stack); failed++;
  } finally {
    try { rmSync(kgDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ============================================================
// Test registry + process isolation
// ============================================================
//
// Each test opens/closes a Kuzu DB several times; co-running many open/close cycles
// against the native kuzu addon in ONE process eventually segfaults (same reason
// phase1 isolates per backend). So the parent spawns ONE child process per test and
// aggregates exit codes. KG_ATTACH_TEST=<name> selects the test in the child.

const TESTS: Record<string, () => void | Promise<void>> = {
  roundtrip: testRoundTrip,
  absence: testDeleteByAbsence,
  merge: testCrossMachineMerge,
  cascade: testCascade,
  gate: testGate,
};

async function childMain(name: string) {
  const fn = TESTS[name];
  if (!fn) { console.error(`Unknown test: ${name}`); process.exit(2); }
  await fn();
  console.error(`\n📊 [${name}] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

function parentMain() {
  console.error('🧪 Attachment Phase 3 Verify — sync (field-carry / attachment-sync / gate / cascade / merge)');
  const self = fileURLToPath(import.meta.url);
  let anyFailed = false;
  for (const name of Object.keys(TESTS)) {
    const res = spawnSync('npx', ['tsx', self], {
      stdio: 'inherit',
      env: { ...process.env, KG_ATTACH_TEST: name },
    });
    if (res.status !== 0) {
      anyFailed = true;
      console.error(`\n💥 Test "${name}" FAILED (status=${res.status}, signal=${res.signal ?? 'none'})`);
    }
  }
  console.error(`\n${'═'.repeat(56)}`);
  console.error(anyFailed ? '❌ Phase 3 verify FAILED' : '✅ Phase 3 verify PASSED (all tests, kuzu)');
  process.exit(anyFailed ? 1 : 0);
}

const childTest = process.env.KG_ATTACH_TEST;
if (childTest) {
  childMain(childTest).catch((e) => { console.error('Fatal:', e); process.exit(1); });
} else {
  parentMain();
}
