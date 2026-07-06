#!/usr/bin/env npx tsx

/**
 * Phase 1 verify — kg beads: issue as Chunk (node + sync).
 *
 * Proves:
 *  1. issue_create mints a short unique ref, stored as category 'issue'.
 *  2. Dedup is bypassed — two near-identical titles = two distinct issues.
 *  3. issue fields (status/priority/blocked_by/ref) survive export → import
 *     to a SECOND database (team-visibility), and blocked_by uses issue_ref.
 *  4. issue_list hides closed; issue_update changes status + CAS guards version.
 *
 * Runs against SOURCE via tsx. Requires Ollama (issues embed like any chunk).
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createStorage } from '../src/storage/interface.js';
import { Embedder } from '../src/engine/embedder.js';
import { Linker } from '../src/engine/linker.js';
import { loadConfig } from '../src/config.js';
import { handleIssueCreate, handleIssueUpdate, handleIssueList, handleIssueShow } from '../src/tools/issue.js';
import { exportAll } from '../src/sync/export.js';
import { importAll } from '../src/sync/import.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.error(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

async function main() {
  console.error('🧪 Phase 1 Verify — kg beads (issue as Chunk + sync)');
  console.error('═'.repeat(56));

  const cfg = loadConfig();
  const embedder = new Embedder(cfg.ollama.url, cfg.ollama.model, cfg.cache.embeddingCacheSize);
  const dir1 = mkdtempSync(join(tmpdir(), 'kg-issue-p1-a-'));
  const dir2 = mkdtempSync(join(tmpdir(), 'kg-issue-p1-b-'));
  const syncDir = mkdtempSync(join(tmpdir(), 'kg-issue-p1-sync-'));
  const s1 = await createStorage('kuzu', join(dir1, 'db'));
  const s2 = await createStorage('kuzu', join(dir2, 'db'));

  try {
    await s1.initialize();
    await s2.initialize();
    const linker1 = new Linker(s1, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK);

    console.error('\n📋 Test 1: create issue → short ref + category issue');
    const i1 = await handleIssueCreate(s1, embedder, linker1,
      { title: 'Betslip odds gate blocks SRM+Boost place-bet', description: 'False-positive odds-decreased', priority: 'p0' },
      'upcoz-mobile');
    assert(/^[a-z0-9]+-[a-z0-9]{7}$/.test(i1.issue_ref), 'issue_ref is short & well-formed', i1.issue_ref);
    const stored1 = await s1.getChunk(i1.id);
    assert(stored1?.category === 'issue', 'stored as category issue', stored1?.category);
    assert(stored1?.issue_status === 'open', 'initial status open', stored1?.issue_status);
    assert(stored1?.issue_priority === 'p0', 'priority p0 persisted', stored1?.issue_priority);

    console.error('\n📋 Test 2: dedup bypass — near-identical titles = 2 issues');
    const i2 = await handleIssueCreate(s1, embedder, linker1,
      { title: 'Betslip odds gate blocks SRM+Boost place-bet', description: 'Same title, different report', priority: 'p1' },
      'upcoz-mobile');
    assert(i1.id !== i2.id, 'two distinct chunk ids', `${i1.id} vs ${i2.id}`);
    assert(i1.issue_ref !== i2.issue_ref, 'two distinct refs', `${i1.issue_ref} vs ${i2.issue_ref}`);

    console.error('\n📋 Test 3: blocked_by uses issue_ref + issue_update + CAS');
    const i3 = await handleIssueCreate(s1, embedder, linker1,
      { title: 'Refactor odds gate', blocked_by: [i1.issue_ref], priority: 'p2' }, 'upcoz-mobile');
    const s3chunk = await s1.getChunk(i3.id);
    assert(s3chunk?.blocked_by?.[0] === i1.issue_ref, 'blocked_by holds issue_ref (not UUID)', JSON.stringify(s3chunk?.blocked_by));
    const upd = await handleIssueUpdate(s1, { issue_ref: i1.issue_ref, status: 'in_progress', expected_version: 1 });
    assert(upd.status === 'in_progress', 'status updated to in_progress');
    assert(upd.version === 2, 'version bumped to 2', String(upd.version));
    let casRejected = false;
    try { await handleIssueUpdate(s1, { issue_ref: i1.issue_ref, status: 'closed', expected_version: 1 }); }
    catch { casRejected = true; }
    assert(casRejected, 'stale expected_version rejected (CAS)');

    console.error('\n📋 Test 4: issue_list hides closed by default');
    await handleIssueUpdate(s1, { issue_ref: i2.issue_ref, status: 'closed' });
    const openList = await handleIssueList(s1, {});
    assert(!openList.some(i => i.issue_ref === i2.issue_ref), 'closed issue hidden by default');
    const allList = await handleIssueList(s1, { include_closed: true });
    assert(allList.some(i => i.issue_ref === i2.issue_ref), 'closed issue shown with include_closed');
    assert(allList[0].priority === 'p0', 'sorted p0 first', allList[0].priority);

    console.error('\n📋 Test 5: SYNC — issue fields survive export → import to DB2 (team-visible)');
    await exportAll(s1, syncDir);
    await importAll(syncDir, s2, embedder, new Linker(s2, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK), cfg);
    const s2issues = await s2.listChunks({ category: 'issue' }, 100);
    const s2i3 = s2issues.find(i => i.issue_ref === i3.issue_ref);
    assert(!!s2i3, 'issue synced to DB2', `found ${s2issues.length} issues`);
    assert(s2i3?.issue_status === 'open', 'status survived sync', s2i3?.issue_status);
    assert(s2i3?.issue_priority === 'p2', 'priority survived sync', s2i3?.issue_priority);
    assert(s2i3?.blocked_by?.[0] === i1.issue_ref, 'blocked_by (issue_ref) survived sync — join stays valid cross-machine', JSON.stringify(s2i3?.blocked_by));
    // Critical: the UUID changed across machines, but issue_ref did not.
    assert(s2i3?.id !== i3.id, 'UUID re-minted on DB2 (proves why blocked_by must use ref, not id)', `${i3.id} vs ${s2i3?.id}`);

    console.error('\n📋 Test 6: issue_show returns the issue');
    const show = await handleIssueShow(s1, { issue_ref: i1.issue_ref });
    assert(show.issue.issue_ref === i1.issue_ref, 'issue_show returns correct issue');
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    await s1.close(); await s2.close();
    for (const d of [dir1, dir2, syncDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  }

  console.error('═'.repeat(56));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
