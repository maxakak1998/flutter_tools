#!/usr/bin/env npx tsx

/**
 * Chunk-id prefix resolution test.
 *
 * Part A (source, real KuzuDB in a temp dir, no Ollama): findChunkIdsByPrefix +
 * resolveChunkId/resolveChunkIdParams — unique prefix → full id, ambiguous prefix →
 * validation error listing candidates, non-prefix values pass through untouched.
 * Part B (built dist/, needs `npm run build`): a daemon RPC (knowledge_validate)
 * called with an 8-char prefix resolves to the full id — the 2026-10-27
 * "knowledge_evolve with an 8-char id → Chunk not found" failure.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createStorage, type IStorage } from '../src/storage/interface.js';
import { EMBEDDING_DIMENSIONS } from '../src/types.js';
import { resolveChunkId, resolveChunkIdParams } from '../src/tools/chunk-id.js';
import { classifyError } from '../src/client.js';

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

const A1 = 'aaaa1111-0000-4000-8000-000000000001';
const A2 = 'aaaa1111-9999-4000-8000-000000000002';
const B = 'bbbb2222-0000-4000-8000-000000000003';
const ARCHIVE = 'archive-00e5954b';

async function seed(storage: IStorage): Promise<void> {
  const base = {
    embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
    source: null,
    domain: 'test',
    importance: 'medium',
    layer: 'core-knowledge',
    keywords: ['prefix'],
    entities: [],
    tags: [],
    version: 1,
    confidence: 0.5,
    validation_count: 0,
    refutation_count: 0,
    last_validated_at: '',
    lifecycle: 'active',
    access_count: 0,
    category: 'fact',
  };
  for (const id of [A1, A2, B, ARCHIVE]) {
    await storage.createChunk({ ...base, id, sync_id: `sync-${id}`, content: `chunk ${id}`, summary: `chunk ${id}` } as any);
  }
}

async function partA(dbPath: string): Promise<void> {
  console.error('\n📋 Part A: storage prefix lookup + resolver');
  const storage = await createStorage('kuzu', dbPath);
  try {
    await seed(storage);

    const both = await storage.findChunkIdsByPrefix('aaaa1111', 6);
    assert(both.length === 2 && both.includes(A1) && both.includes(A2), 'findChunkIdsByPrefix returns both ids sharing a prefix', JSON.stringify(both));
    const exact = await storage.findChunkIdsByPrefix(B, 6);
    assert(exact.length === 1 && exact[0] === B, 'findChunkIdsByPrefix includes the exact id', JSON.stringify(exact));

    assert(await resolveChunkId(storage, 'bbbb2222') === B, 'unique 8-char prefix → full id');
    assert(await resolveChunkId(storage, A2.slice(0, 13)) === A2, 'unique longer prefix → full id');
    assert(await resolveChunkId(storage, B) === B, 'full id → unchanged');
    assert(await resolveChunkId(storage, 'bbbb222') === 'bbbb222', '7-char prefix (below minimum) → unchanged');
    assert(await resolveChunkId(storage, 'cccc3333') === 'cccc3333', 'prefix with no match → unchanged (handler reports not found)');
    assert(await resolveChunkId(storage, ARCHIVE) === ARCHIVE, 'non-hex id ("archive-…") → unchanged');

    let err: unknown = null;
    try {
      await resolveChunkId(storage, 'aaaa1111');
    } catch (e) {
      err = e;
    }
    const msg = err instanceof Error ? err.message : '';
    assert(/Ambiguous chunk id prefix/.test(msg) && msg.includes(A1) && msg.includes(A2), 'ambiguous prefix throws, listing every candidate', msg);
    assert(classifyError(err).code === 'validation', 'ambiguous-prefix error classifies as validation', classifyError(err).code);

    const input = { source_id: 'bbbb2222', target_id: A1, relation: 'relates_to' };
    const out = await resolveChunkIdParams(storage, 'knowledge_link', input);
    assert(out.source_id === B && out.target_id === A1, 'resolveChunkIdParams resolves knowledge_link source_id/target_id');
    assert(input.source_id === 'bbbb2222', 'resolveChunkIdParams does not mutate its input');
    const untouched = { query: 'aaaa1111' };
    assert(await resolveChunkIdParams(storage, 'knowledge_query', untouched) === untouched, 'methods without chunk-id params are passed through as-is');
  } finally {
    await storage.close();
  }
}

async function partB(projectDir: string): Promise<void> {
  console.error('\n📋 Part B: daemon resolves an 8-char prefix on knowledge_validate (dist/)');
  const { ensureDaemon } = await import('../dist/daemon-manager.js');
  const { loadConfig } = await import('../dist/config.js');
  const kgDir = join(projectDir, '.knowledge-graph');
  const config = {
    version: 2,
    project_id: randomUUID(),
    project_name: 'chunk-id-test',
    created_at: new Date().toISOString(),
    daemon: { port_range_start: 0, idle_timeout_ms: 60_000 },
    overrides: {},
  };
  writeFileSync(join(kgDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  const project = {
    projectId: config.project_id,
    projectName: config.project_name,
    projectDir,
    kgDir,
    dbPath: join(kgDir, 'data', 'knowledge'),
    configPath: join(kgDir, 'config.json'),
    daemonPortFile: join(kgDir, 'daemon.port'),
    daemonPidFile: join(kgDir, 'daemon.pid'),
    config,
  };
  const url = await ensureDaemon(project as any, loadConfig());
  try {
    const rpc = async (method: string, params: Record<string, unknown>) => {
      const res = await fetch(`${url}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params: { client_session_id: 'chunk-id-test', ...params }, id: 1 }),
      });
      return res.json() as Promise<{ result?: any; error?: { message: string } }>;
    };
    const ok = await rpc('knowledge_validate', { id: 'bbbb2222', action: 'confirm', evidence: 'test' });
    assert(ok.result?.id === B, 'knowledge_validate with an 8-char prefix hits the full-id chunk', JSON.stringify(ok).slice(0, 160));
    const amb = await rpc('knowledge_validate', { id: 'aaaa1111', action: 'confirm', evidence: 'test' });
    assert(/Ambiguous chunk id prefix/.test(amb.error?.message ?? ''), 'ambiguous prefix over RPC → error listing candidates', JSON.stringify(amb).slice(0, 160));
    const miss = await rpc('knowledge_validate', { id: 'cccc3333', action: 'confirm', evidence: 'test' });
    assert(/not found/i.test(miss.error?.message ?? ''), 'unknown prefix over RPC → not found (unchanged behaviour)', JSON.stringify(miss).slice(0, 160));
  } finally {
    await fetch(`${url}/rpc/shutdown`, { method: 'POST' }).catch(() => {});
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      try {
        readFileSync(project.daemonPidFile);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        break;
      }
    }
  }
}

async function main(): Promise<void> {
  console.error('🧪 Chunk-id prefix resolution test');
  console.error('═'.repeat(50));
  const projectDir = mkdtempSync(join(tmpdir(), 'kg-chunk-id-'));
  const kgDir = join(projectDir, '.knowledge-graph');
  mkdirSync(join(kgDir, 'data'), { recursive: true });
  try {
    await partA(join(kgDir, 'data', 'knowledge'));
    await partB(projectDir);
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
  console.error('═'.repeat(50));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
