#!/usr/bin/env npx tsx

/**
 * Phase 2 verify — Attachment TOOLS (add / list / remove / gc) + issue_show.
 *
 * Proves the local (no-sync) evidence loop on the default backend (kuzu):
 *  1. add → bytes land at attachments/<sha>.<ext>, an Attachment row exists, and
 *     the target chunk's attachment_refs contains "<sha>|<caption>".
 *  2. dedup: same image + same chunk → 1 file, 1 row, 1 ref (second add no-ops the ref).
 *  3. fan-out: same image on TWO chunks → 1 row, 2 refs (countAttachmentRefs === 2).
 *  4. list by chunk_id AND by issue_ref → returns the image + caption + rel_path.
 *  5. issue_show → attachments[] present.
 *  6. remove: removing the last ref → ref-count 0 → row + bytes deleted.
 *  7. errors: source > cap → "file too large"; directory/missing → "invalid source".
 *  8. gc: orphan bytes with no row are reported (and evicted on request).
 *
 * Bytes are NEVER embedded. Requires Ollama (chunks embed on create).
 * Runs against SOURCE via tsx. Temp dirs, cleans up after.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createStorage, StorageBackend } from '../src/storage/interface.js';
import { Embedder } from '../src/engine/embedder.js';
import { Linker } from '../src/engine/linker.js';
import { loadConfig } from '../src/config.js';
import { StoredChunk } from '../src/types.js';
import {
  handleAttachmentAdd,
  handleAttachmentList,
  handleAttachmentRemove,
  handleAttachmentGc,
  DEFAULT_ATTACHMENT_CAP_BYTES,
} from '../src/tools/attachment.js';
import { handleIssueCreate, handleIssueShow } from '../src/tools/issue.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.error(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const cfg = loadConfig();
const embedder = new Embedder(cfg.ollama.url, cfg.ollama.model, cfg.cache.embeddingCacheSize);

/** A minimal valid PNG (8-byte signature + a few bytes) so magic-byte sniff detects png. */
function pngBytes(salt: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`fake-png-payload-${salt}-${'x'.repeat(64)}`),
  ]);
}

function makeChunk(id: string, content: string, embedding: number[]): Omit<StoredChunk, 'created_at' | 'updated_at' | 'issue_ref' | 'issue_status' | 'issue_priority' | 'blocked_by' | 'attachment_refs'> {
  return {
    id, sync_id: id, content, summary: content.slice(0, 60), embedding, source: null,
    category: 'fact', domain: 'attachment-p2', importance: 'medium', layer: 'core-knowledge',
    keywords: ['attachment', 'evidence'], entities: [], tags: [], version: 1,
    confidence: 0.5, validation_count: 0, refutation_count: 0, last_validated_at: '',
    lifecycle: 'active', access_count: 0,
  };
}

async function run(backend: StorageBackend) {
  console.error(`\n${'═'.repeat(56)}\n🧪 Phase 2 — attachment tools (${backend})\n${'═'.repeat(56)}`);
  const kgDir = mkdtempSync(join(tmpdir(), `kg-attach-p2-${backend}-`));
  mkdirSync(join(kgDir, 'attachments'), { recursive: true });
  const srcDir = mkdtempSync(join(tmpdir(), 'kg-attach-src-'));
  const attachmentsDir = join(kgDir, 'attachments');

  const storage = await createStorage(backend, join(kgDir, 'db'));
  const linker = new Linker(storage, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK);

  try {
    // Two real chunks + one issue to attach onto.
    const embA = await embedder.embed('chunk A holds evidence of the force-update dialog bug');
    const idA = randomUUID();
    await storage.createChunk(makeChunk(idA, 'Force-update dialog shows wrong copy in VN locale.', embA));
    const embB = await embedder.embed('chunk B references the same shorebird patch screenshot');
    const idB = randomUUID();
    await storage.createChunk(makeChunk(idB, 'Shorebird patch dialog affected by the same screenshot.', embB));
    const issue = await handleIssueCreate(storage, embedder, linker, { title: 'force-update dialog wrong copy', priority: 'p1' }, 'kg-test');

    // Write the evidence image to a temp source path.
    const img = pngBytes(1);
    const srcPath = join(srcDir, '30_force.png');
    writeFileSync(srcPath, img);

    // ── Test 1: add → bytes + row + chunk ref ──────────────────
    console.error('\n📋 Test 1: add → bytes on disk + Attachment row + chunk.attachment_refs');
    const add1 = await handleAttachmentAdd(storage, kgDir, { source: srcPath, attach_to: { chunk_id: idA }, caption: 'Force EN' });
    const diskFiles = readdirSync(attachmentsDir).filter(f => !f.startsWith('.tmp-'));
    assert(diskFiles.length === 1 && diskFiles[0] === `${add1.sha256}.png`, 'bytes written to attachments/<sha>.png', diskFiles.join(','));
    assert(existsSync(join(attachmentsDir, `${add1.sha256}.png`)), 'bytes file exists on disk');
    const row1 = await storage.getAttachment(add1.sha256);
    assert(row1 !== null && row1.mime === 'image/png' && row1.filename === '30_force.png', 'Attachment row created (png, filename)', JSON.stringify(row1));
    assert(row1?.size_bytes === img.length, 'row size_bytes matches source', `${row1?.size_bytes} vs ${img.length}`);
    const chunkA1 = await storage.getChunk(idA);
    assert((chunkA1?.attachment_refs ?? []).includes(`${add1.sha256}|Force EN`), 'chunk.attachment_refs has "<sha>|Force EN"', JSON.stringify(chunkA1?.attachment_refs));
    assert(add1.rel_path === `.knowledge-graph/attachments/${add1.sha256}.png`, 'rel_path shape', add1.rel_path);

    // ── Test 2: dedup — same image, same chunk ─────────────────
    console.error('\n📋 Test 2: dedup — same image + same chunk = 1 file / 1 row / 1 ref');
    const add2 = await handleAttachmentAdd(storage, kgDir, { source: srcPath, attach_to: { chunk_id: idA }, caption: 'Force EN again' });
    assert(add2.sha256 === add1.sha256, 'same content → same sha256');
    assert(add2.deduped === true, 'add reports deduped');
    const filesAfter = readdirSync(attachmentsDir).filter(f => !f.startsWith('.tmp-'));
    assert(filesAfter.length === 1, 'still exactly 1 bytes file', String(filesAfter.length));
    const chunkA2 = await storage.getChunk(idA);
    assert((chunkA2?.attachment_refs ?? []).length === 1, 'still exactly 1 ref on chunk A', String(chunkA2?.attachment_refs?.length));
    assert((await storage.listAttachments({})).length === 1, 'still exactly 1 Attachment row');

    // ── Test 3: fan-out — same image, two chunks ───────────────
    console.error('\n📋 Test 3: same image on TWO chunks = 1 row / 2 refs');
    await handleAttachmentAdd(storage, kgDir, { source: srcPath, attach_to: { chunk_id: idB }, caption: 'Reused on B' });
    assert((await storage.listAttachments({})).length === 1, '1 shared Attachment row across chunks');
    assert((await storage.countAttachmentRefs(add1.sha256)) === 2, 'countAttachmentRefs === 2 (A + B)');

    // ── Test 4: list by chunk_id and by issue_ref ──────────────
    console.error('\n📋 Test 4: list by chunk_id + by issue_ref');
    const listA = await handleAttachmentList(storage, kgDir, { chunk_id: idA });
    assert(listA.attachments.length === 1 && listA.attachments[0].caption === 'Force EN', 'list by chunk_id → 1 image + caption', JSON.stringify(listA.attachments));
    assert(listA.attachments[0].rel_path === `.knowledge-graph/attachments/${add1.sha256}.png`, 'list rel_path is ext-correct', listA.attachments[0].rel_path);
    // attach to the issue too, then list by issue_ref
    await handleAttachmentAdd(storage, kgDir, { source: srcPath, attach_to: { issue_ref: issue.issue_ref }, caption: 'On the issue' });
    const listI = await handleAttachmentList(storage, kgDir, { issue_ref: issue.issue_ref });
    assert(listI.attachments.length === 1 && listI.attachments[0].caption === 'On the issue', 'list by issue_ref → 1 image + caption', JSON.stringify(listI.attachments));

    // ── Test 5: issue_show surfaces attachments ────────────────
    console.error('\n📋 Test 5: issue_show → attachments[]');
    const shown = await handleIssueShow(storage, { issue_ref: issue.issue_ref });
    assert(Array.isArray(shown.attachments) && shown.attachments.length === 1, 'issue_show returns attachments[]', JSON.stringify(shown.attachments));
    assert(shown.attachments[0].sha256 === add1.sha256 && shown.attachments[0].rel_path === `.knowledge-graph/attachments/${add1.sha256}.png`, 'issue_show attachment sha + rel_path');

    // ── Test 6: remove — last ref triggers GC ──────────────────
    console.error('\n📋 Test 6: remove last ref → ref-count 0 → row + bytes deleted');
    // sha is on A, B, and the issue → remove from all three; only the last should GC.
    const rmA = await handleAttachmentRemove(storage, kgDir, { sha256: add1.sha256, chunk_id: idA });
    assert(rmA.removed_ref && !rmA.row_deleted && rmA.remaining_refs === 2, 'remove from A: ref gone, row kept (2 remain)', JSON.stringify(rmA));
    await handleAttachmentRemove(storage, kgDir, { sha256: add1.sha256, chunk_id: idB });
    const rmLast = await handleAttachmentRemove(storage, kgDir, { sha256: add1.sha256, issue_ref: issue.issue_ref });
    assert(rmLast.remaining_refs === 0 && rmLast.row_deleted && rmLast.bytes_deleted, 'last remove: row + bytes deleted', JSON.stringify(rmLast));
    assert((await storage.getAttachment(add1.sha256)) === null, 'Attachment row gone after GC');
    assert(!existsSync(join(attachmentsDir, `${add1.sha256}.png`)), 'bytes file gone after GC');

    // ── Test 7: error paths ────────────────────────────────────
    console.error('\n📋 Test 7: errors — oversize + directory + missing');
    const bigPath = join(srcDir, 'big.png');
    writeFileSync(bigPath, Buffer.concat([pngBytes(9), Buffer.alloc(64)]));
    let capErr = '';
    try { await handleAttachmentAdd(storage, kgDir, { source: bigPath, attach_to: { chunk_id: idA }, cap: 32 }); }
    catch (e) { capErr = e instanceof Error ? e.message : String(e); }
    assert(/file too large \(max/.test(capErr), 'oversize → "file too large (max ...)"', capErr);

    let dirErr = '';
    try { await handleAttachmentAdd(storage, kgDir, { source: srcDir, attach_to: { chunk_id: idA } }); }
    catch (e) { dirErr = e instanceof Error ? e.message : String(e); }
    assert(/invalid source:.*directory/.test(dirErr), 'directory → "invalid source: ... directory"', dirErr);

    let missErr = '';
    try { await handleAttachmentAdd(storage, kgDir, { source: join(srcDir, 'nope.png'), attach_to: { chunk_id: idA } }); }
    catch (e) { missErr = e instanceof Error ? e.message : String(e); }
    assert(/invalid source:.*not found/.test(missErr), 'missing → "invalid source: ... not found"', missErr);

    // ── Test 8: gc reports/evicts orphans ──────────────────────
    console.error('\n📋 Test 8: gc — orphan bytes (no row) reported + evicted');
    // Drop a stray bytes file with no matching row.
    const orphanName = `${'f'.repeat(64)}.png`;
    writeFileSync(join(attachmentsDir, orphanName), pngBytes(7));
    const gcReport = await handleAttachmentGc(storage, kgDir, {});
    assert(gcReport.orphan_bytes.includes(orphanName) && !gcReport.evicted, 'gc reports orphan bytes (read-only)', JSON.stringify(gcReport.orphan_bytes));
    const gcEvict = await handleAttachmentGc(storage, kgDir, { evict: true });
    assert(gcEvict.evicted && !existsSync(join(attachmentsDir, orphanName)), 'gc evict deletes orphan bytes');
  } catch (e) {
    console.error(`\n💥 FATAL (${backend}): ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    try { await storage.close(); } catch { /* ignore */ }
    try { rmSync(kgDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(srcDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function main() {
  console.error('🧪 Attachment Phase 2 Verify — tools (add/list/remove/gc) + issue_show');
  console.error(`   (default cap = ${DEFAULT_ATTACHMENT_CAP_BYTES} bytes)`);
  await run('kuzu'); // default backend — hard gate
  console.error(`\n${'═'.repeat(56)}\n📊 ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
