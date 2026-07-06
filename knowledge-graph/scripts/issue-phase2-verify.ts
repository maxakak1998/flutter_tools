#!/usr/bin/env npx tsx

/**
 * Phase 2 verify — kg beads: linking + auto-link (the closed loop).
 *
 * Proves:
 *  1. Setting current_issue anchors the session; a decision written afterward
 *     AUTO-LINKS to that issue (edge visible via issue_show).
 *  2. A chunk written with NO anchor creates NO spurious edge, but IS surfaced
 *     by issue_orphans (chunk-side blind-spot patch).
 *  3. issue_link manually attaches an orphan; it then leaves the orphan list.
 *  4. Clearing the anchor (empty string) stops auto-linking.
 *
 * Mirrors the daemon's store→auto-link sequence in-process (no live daemon).
 * Requires Ollama.
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createStorage } from '../src/storage/interface.js';
import { Embedder } from '../src/engine/embedder.js';
import { Linker } from '../src/engine/linker.js';
import { loadConfig } from '../src/config.js';
import { handleIssueCreate, handleIssueShow, handleIssueOrphans, handleIssueLink, autoLinkToIssue } from '../src/tools/issue.js';
import { handleStateSetContext, getCurrentIssue } from '../src/tools/state-context.js';
import { handleDecisionRecord } from '../src/tools/decision.js';
import { handleStore } from '../src/tools/store.js';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.error(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const SESSION = 'sess-phase2';

async function main() {
  console.error('🧪 Phase 2 Verify — kg beads (linking + auto-link)');
  console.error('═'.repeat(56));

  const cfg = loadConfig();
  const embedder = new Embedder(cfg.ollama.url, cfg.ollama.model, cfg.cache.embeddingCacheSize);
  const dir = mkdtempSync(join(tmpdir(), 'kg-issue-p2-'));
  const storage = await createStorage('kuzu', join(dir, 'db'));

  try {
    await storage.initialize();
    const linker = new Linker(storage, embedder, cfg.search.similarityThreshold, cfg.search.autoLinkTopK);
    const PROJ = 'proj-p2';

    // Simulate the daemon's "store then auto-link to current_issue" sequence.
    const storeWithAutoLink = async (content: string, summary: string, category: 'decision' | 'insight') => {
      let id: string;
      if (category === 'decision') {
        const r = await handleDecisionRecord(storage, embedder, linker, content, summary, 'p2', ['phase2'], 'high', undefined, undefined);
        id = r.id;
      } else {
        const r = await handleStore(storage, embedder, linker, content, { summary, keywords: ['phase2'], domain: 'p2', category, importance: 'medium' });
        id = r.id;
      }
      const anchor = await getCurrentIssue(storage, SESSION, PROJ);
      const linked = await autoLinkToIssue(storage, id, anchor);
      return { id, linked };
    };

    console.error('\n📋 Test 1: anchor session → decision auto-links to issue');
    const issue = await handleIssueCreate(storage, embedder, linker, { title: 'Fix odds gate', priority: 'p1' }, 'proj');
    await handleStateSetContext(storage, SESSION, PROJ, 'Working on odds gate', undefined, undefined, undefined, issue.issue_ref);
    const anchor = await getCurrentIssue(storage, SESSION, PROJ);
    assert(anchor === issue.issue_ref, 'current_issue anchor set', `${anchor}`);

    const d1 = await storeWithAutoLink('Chose to compare boosted odds vs boosted baseline, not preBoost.', 'Odds gate: compare boosted vs boosted', 'decision');
    assert(d1.linked !== null, 'decision auto-linked to an issue', `linked=${d1.linked}`);
    const show1 = await handleIssueShow(storage, { issue_ref: issue.issue_ref });
    assert(show1.linked.some(l => l.id === d1.id), 'issue_show surfaces the linked decision', `${show1.linked.length} linked`);

    console.error('\n📋 Test 2: no anchor → no spurious edge, but orphan surfaced');
    await handleStateSetContext(storage, SESSION, PROJ, 'Unrelated work', undefined, undefined, undefined, ''); // clear anchor
    const clearedAnchor = await getCurrentIssue(storage, SESSION, PROJ);
    assert(clearedAnchor === null, 'anchor cleared with empty string', `${clearedAnchor}`);

    const d2 = await storeWithAutoLink('Some decision made with no issue in focus.', 'Orphan decision', 'decision');
    assert(d2.linked === null, 'no auto-link when anchor cleared (no garbage edge)');
    const orphans = await handleIssueOrphans(storage, {});
    assert(orphans.some(o => o.id === d2.id), 'orphan decision surfaced by issue_orphans', `${orphans.length} orphans`);
    assert(!orphans.some(o => o.id === d1.id), 'linked decision NOT in orphan list');

    console.error('\n📋 Test 3: issue_link attaches an orphan → leaves orphan list');
    await handleIssueLink(storage, { issue_ref: issue.issue_ref, chunk_id: d2.id });
    const orphans2 = await handleIssueOrphans(storage, {});
    assert(!orphans2.some(o => o.id === d2.id), 'manually-linked chunk no longer orphan');
    const show2 = await handleIssueShow(storage, { issue_ref: issue.issue_ref });
    assert(show2.linked.some(l => l.id === d2.id), 'issue_show now includes the manually-linked chunk');

    console.error('\n📋 Test 4: re-anchor → auto-link resumes');
    await handleStateSetContext(storage, SESSION, PROJ, 'Back on odds gate', undefined, undefined, undefined, issue.issue_ref);
    const d3 = await storeWithAutoLink('Follow-up insight while back on the issue.', 'Follow-up insight', 'insight');
    assert(d3.linked !== null, 'auto-link resumes after re-anchor');
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    await storage.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.error('═'.repeat(56));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
