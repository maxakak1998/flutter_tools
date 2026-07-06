#!/usr/bin/env npx tsx

/**
 * Embed retry test (Fix 2).
 *
 * Proves the Embedder retries transient Ollama failures (5xx / EOF) with backoff
 * and eventually succeeds, but fails fast on permanent errors (model not found,
 * 4xx). Uses a fake Ollama HTTP server — no real Ollama needed.
 *
 * Runs against SOURCE via tsx (imports ../src/engine/embedder.ts).
 */

import { createServer, Server } from 'http';
import { Embedder } from '../src/engine/embedder.js';
import { EMBEDDING_DIMENSIONS } from '../src/types.js';

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

/** Start a fake Ollama on a random port. `handler` decides each response. */
function startFakeOllama(
  handler: (attempt: number, res: import('http').ServerResponse) => void,
): Promise<{ url: string; server: Server; getCount: () => number }> {
  let count = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      // Drain body then dispatch.
      req.on('data', () => {});
      req.on('end', () => {
        count++;
        handler(count, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server, getCount: () => count });
    });
  });
}

function okEmbedding(res: import('http').ServerResponse): void {
  const vec = new Array(EMBEDDING_DIMENSIONS).fill(0.01);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ embeddings: [vec] }));
}

async function main() {
  console.error('🧪 Embed Retry Test (Fix 2)');
  console.error('═'.repeat(50));

  // ── Test 1: transient 5xx twice, then 200 → succeeds after retry ──
  console.error('\n📋 Test 1: 5xx ×2 then 200 → succeeds');
  {
    const fake = await startFakeOllama((attempt, res) => {
      if (attempt <= 2) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'do embedding request: EOF' }));
      } else {
        okEmbedding(res);
      }
    });
    try {
      const embedder = new Embedder(fake.url, 'bge-m3', 10);
      const vec = await embedder.embed('hello world');
      assert(vec.length === EMBEDDING_DIMENSIONS, 'Returns a full embedding after retries', `len=${vec.length}`);
      assert(fake.getCount() === 3, 'Made exactly 3 attempts (2 fail + 1 ok)', `attempts=${fake.getCount()}`);
    } finally {
      fake.server.close();
    }
  }

  // ── Test 2: model not found → fail fast, no retry ──
  console.error('\n📋 Test 2: "not found" → fails immediately (no retry)');
  {
    const fake = await startFakeOllama((_attempt, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'model "bge-m3" not found' }));
    });
    try {
      const embedder = new Embedder(fake.url, 'bge-m3', 10);
      let threw = false;
      try { await embedder.embed('x'); } catch { threw = true; }
      assert(threw, 'Throws on model-not-found');
      assert(fake.getCount() === 1, 'Only 1 attempt (no retry on permanent error)', `attempts=${fake.getCount()}`);
    } finally {
      fake.server.close();
    }
  }

  // ── Test 3: persistent 5xx → exhausts retries then throws ──
  console.error('\n📋 Test 3: 5xx always → exhausts 3 attempts then throws');
  {
    const fake = await startFakeOllama((_attempt, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'overloaded' }));
    });
    try {
      const embedder = new Embedder(fake.url, 'bge-m3', 10);
      let threw = false;
      try { await embedder.embed('y'); } catch { threw = true; }
      assert(threw, 'Throws after exhausting retries');
      assert(fake.getCount() === 3, 'Made exactly 3 attempts before giving up', `attempts=${fake.getCount()}`);
    } finally {
      fake.server.close();
    }
  }

  // ── Test 4: 4xx (bad request) → fail fast, no retry ──
  console.error('\n📋 Test 4: 400 → fails immediately (no retry)');
  {
    const fake = await startFakeOllama((_attempt, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request' }));
    });
    try {
      const embedder = new Embedder(fake.url, 'bge-m3', 10);
      let threw = false;
      try { await embedder.embed('z'); } catch { threw = true; }
      assert(threw, 'Throws on 4xx');
      assert(fake.getCount() === 1, 'Only 1 attempt (no retry on 4xx)', `attempts=${fake.getCount()}`);
    } finally {
      fake.server.close();
    }
  }

  console.error('═'.repeat(50));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
