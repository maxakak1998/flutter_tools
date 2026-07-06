#!/usr/bin/env npx tsx

/**
 * Phase 3 verify — kg beads: ready-work + priority + stale.
 *
 * Proves:
 *  1. issue_ready hides an issue while a blocker is open; reveals it once the
 *     blocker closes (in-memory join over blocked_by refs).
 *  2. Ready-work is priority-sorted (p0 first).
 *  3. Scale: works past the default-50 list limit (60 issues) [Judge 3].
 *  4. Cross-machine: after export→import (UUIDs re-minted), ready-work still
 *     correct because blocked_by joins on issue_ref, not id [Judge 1].
 *  5. issue_stale surfaces old open issues (simulated clock).
 *
 * Requires Ollama.
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createStorage } from '../src/storage/interface.js';
import { Embedder } from '../src/engine/embedder.js';
import { Linker } from '../src/engine/linker.js';
import { loadConfig } from '../src/config.js';
import { handleIssueCreate, handleIssueUpdate, handleIssueReady, handleIssueStale } from '../src/tools/issue.js';
import { exportAll } from '../src/sync/export.js';
import { importAll } from '../src/sync/import.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.error(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

async function main() {
  console.error('🧪 Phase 3 Verify — kg beads (ready-work + priority + stale)');
  console.error('═'.repeat(56));

  const cfg = loadConfig();
  const embedder = new Embedder(cfg.ollama.url, cfg.ollama.model, cfg.cache.embeddingCacheSize);
  const dir1 = mkdtempSync(join(tmpdir(), 'kg-issue-p3-a-'));
  const dir2 = mkdtempSync(join(tmpdir(), 'kg-issue-p3-b-'));
  const syncDir = mkdtempSync(join(tmpdir(), 'kg-issue-p3-sync-'));
  const s1 = await createStorage('kuzu', join(dir1, 'db'));
  const s2 = await createStorage('kuzu', join(dir2, 'db'));

  try {
    await s1.initialize();
    await s2.initialize();
    const linker1 = new Linker(s1, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK);
    const mk = (title: string, priority: any, blocked_by?: string[]) =>
      handleIssueCreate(s1, embedder, linker1, { title, priority, blocked_by }, 'proj');

    console.error('\n📋 Test 1: blocked issue not ready; unblocks when blocker closes');
    const blocker = await mk('Migrate schema', 'p1');
    const dependent = await mk('Use new schema', 'p1', [blocker.issue_ref]);
    let ready = await handleIssueReady(s1, {});
    assert(ready.some(r => r.issue_ref === blocker.issue_ref), 'blocker itself is ready (no blockers)');
    assert(!ready.some(r => r.issue_ref === dependent.issue_ref), 'dependent NOT ready while blocker open');

    await handleIssueUpdate(s1, { issue_ref: blocker.issue_ref, status: 'closed' });
    ready = await handleIssueReady(s1, {});
    assert(ready.some(r => r.issue_ref === dependent.issue_ref), 'dependent becomes ready after blocker closes');
    assert(!ready.some(r => r.issue_ref === blocker.issue_ref), 'closed blocker no longer in ready list');

    console.error('\n📋 Test 2: priority sort (p0 first)');
    await mk('Urgent', 'p0');
    await mk('Low', 'p3');
    ready = await handleIssueReady(s1, {});
    assert(ready[0].priority === 'p0', 'p0 sorts first', ready[0].priority);

    console.error('\n📋 Test 3: scale >50 issues (past default list limit)');
    for (let i = 0; i < 60; i++) await mk(`Bulk issue ${i}`, 'p2');
    ready = await handleIssueReady(s1, {});
    assert(ready.length > 50, 'ready-work sees >50 issues (not truncated at 50)', `count=${ready.length}`);

    console.error('\n📋 Test 4: cross-machine ready-work after sync (UUID re-minted, ref stable)');
    // A fresh blocked pair to check post-sync join.
    const xb = await mk('X blocker', 'p1');
    const xd = await mk('X dependent', 'p1', [xb.issue_ref]);
    await exportAll(s1, syncDir);
    await importAll(syncDir, s2, embedder, new Linker(s2, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK), cfg);
    let ready2 = await handleIssueReady(s2, {});
    assert(!ready2.some(r => r.issue_ref === xd.issue_ref), 'dependent NOT ready on DB2 (blocker still open) — join survived sync');
    // Close blocker on DB2 side via its ref, re-check.
    await handleIssueUpdate(s2, { issue_ref: xb.issue_ref, status: 'closed' });
    ready2 = await handleIssueReady(s2, {});
    assert(ready2.some(r => r.issue_ref === xd.issue_ref), 'dependent ready on DB2 after closing blocker by ref');

    console.error('\n📋 Test 5: issue_stale surfaces old open issues');
    // "Now" 30 days in the future → 14-day threshold makes existing open issues stale.
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const stale = await handleIssueStale(s1, { days: 14, now: future });
    assert(stale.length > 0, 'stale report finds old open issues', `count=${stale.length}`);
    assert(stale.every(s => s.days_stale >= 14), 'all reported issues exceed threshold');
    // A freshly-updated issue should not be stale relative to real now.
    const staleNow = await handleIssueStale(s1, { days: 14 });
    assert(staleNow.length === 0, 'nothing stale relative to real now (all just created)', `count=${staleNow.length}`);
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
