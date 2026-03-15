#!/usr/bin/env node

/**
 * Daemon process — owns the KuzuDB lock, serves JSON-RPC over HTTP,
 * hosts the dashboard, and auto-shuts down after idle timeout.
 *
 * Spawned by daemon-manager.ts via child_process.fork() with detached: true.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createCore, CoreComponents } from './core.js';
import { parseRpcRequest, formatResult, formatError, JsonRpcResponse } from './rpc.js';
import { KnowledgeConfig } from './config.js';
import { log } from './types.js';
import { randomUUID } from 'crypto';
import { DashboardServer } from './dashboard/server.js';
import { handleQuery } from './tools/query.js';
import { handleStore } from './tools/store.js';

import { handleLink } from './tools/link.js';
import { handleList } from './tools/list.js';
import { handleDelete } from './tools/delete.js';
import { handleEvolve } from './tools/evolve.js';
import { handleValidate } from './tools/validate.js';
import { handlePromote } from './tools/promote.js';

// ============================================================
// Main daemon entry point
// ============================================================

async function daemonMain(): Promise<void> {
  const configJson = process.env.KG_DAEMON_CONFIG;
  const kgDir = process.env.KG_PROJECT_DIR;
  const projectId = process.env.KG_PROJECT_ID;

  if (!configJson || !kgDir || !projectId) {
    log('Daemon: missing required env vars (KG_DAEMON_CONFIG, KG_PROJECT_DIR, KG_PROJECT_ID)');
    process.exit(1);
  }

  const config: KnowledgeConfig = JSON.parse(configJson);
  const portFile = join(kgDir, 'daemon.port');
  const pidFile = join(kgDir, 'daemon.pid');
  const idleTimeoutMs = parseInt(process.env.KG_IDLE_TIMEOUT_MS || '300000', 10);

  let core: CoreComponents;
  try {
    core = await createCore(config);
  } catch (e) {
    log('Daemon: failed to initialize core:', e);
    process.exit(1);
  }

  const { storage, embedder, retriever, linker, eventBus } = core;

  // Dashboard (reuse existing DashboardServer for API routes)
  const dashboard = new DashboardServer(storage, embedder, retriever, eventBus);

  // Register dashboard triggers for pipeline visualization
  dashboard.registerTrigger('query', async (params) => {
    const { query, filters } = params as { query: string; filters?: Record<string, unknown> };
    const requestId = randomUUID();
    const onStep = eventBus.makeStepEmitter(requestId, 'query');
    onStep('start', `Query: "${query.slice(0, 60)}"`);
    const t0 = performance.now();
    const result = await handleQuery(retriever, query, filters as any, onStep);
    onStep('complete', `${result.total} results`, { duration_ms: Math.round(performance.now() - t0), result_count: result.total });
    return result;
  });

  dashboard.registerTrigger('store', async (params) => {
    const { content, metadata } = params as { content: string; metadata: Record<string, unknown> };
    const requestId = randomUUID();
    const onStep = eventBus.makeStepEmitter(requestId, 'store');
    onStep('start', `Store: "${(metadata.summary as string || '').slice(0, 50)}"`);
    const t0 = performance.now();
    const result = await handleStore(storage, embedder, linker, content, metadata as any, onStep, config.dedup.similarityThreshold, config.learning.hypothesisInitialConfidence);
    onStep('complete', `Stored ${result.id}`, { duration_ms: Math.round(performance.now() - t0), id: result.id, auto_links: result.auto_links.length });
    return result;
  });

  dashboard.registerTrigger('evolve', async (params) => {
    const { id, new_content, new_metadata, reason } = params as { id: string; new_content: string; new_metadata?: Record<string, unknown>; reason: string };
    const requestId = randomUUID();
    const onStep = eventBus.makeStepEmitter(requestId, 'evolve');
    onStep('start', `Evolve: ${id.slice(0, 8)}...`);
    const t0 = performance.now();
    const result = await handleEvolve(storage, embedder, linker, id, new_content, new_metadata as any, reason, onStep);
    onStep('complete', `Evolved to v${result.version}`, { duration_ms: Math.round(performance.now() - t0), version: result.version });
    return result;
  });

  dashboard.registerTrigger('validate', async (params) => {
    const { id, action, evidence, context } = params as { id: string; action: 'confirm' | 'refute'; evidence?: string; context?: string };
    return await handleValidate(storage, id, action, config.learning, evidence, context);
  });

  dashboard.registerTrigger('promote', async (params) => {
    const { id, reason, new_category, new_importance } = params as { id: string; reason: string; new_category?: any; new_importance?: any };
    return await handlePromote(storage, id, reason, new_category, new_importance);
  });

  // Client tracking + idle shutdown
  let clientCount = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const startTime = Date.now();

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function startIdleTimer() {
    resetIdleTimer();
    idleTimer = setTimeout(async () => {
      log(`Daemon: idle for ${idleTimeoutMs / 1000}s with no clients, shutting down`);
      await shutdown();
    }, idleTimeoutMs);
  }

  // Start idle timer immediately (no clients yet)
  startIdleTimer();

  // ============================================================
  // RPC dispatch — maps tool names to handler calls
  // ============================================================

  async function dispatchRpc(method: string, params: any): Promise<unknown> {
    const requestId = randomUUID();
    const onStep = eventBus.makeStepEmitter(requestId, method);

    switch (method) {
      case 'knowledge_query': {
        onStep('start', `Query: "${(params.query || '').slice(0, 60)}"`);
        const t0 = performance.now();
        const result = await handleQuery(retriever, params.query, params.filters, onStep);
        onStep('complete', `${result.total} results`, { duration_ms: Math.round(performance.now() - t0), result_count: result.total });
        return result;
      }
      case 'knowledge_store': {
        onStep('start', `Store: "${(params.metadata?.summary || '').slice(0, 50)}"`);
        const t0 = performance.now();
        const result = await handleStore(storage, embedder, linker, params.content, params.metadata, onStep, config.dedup.similarityThreshold, config.learning.hypothesisInitialConfidence);
        onStep('complete', `Stored ${result.id}`, { duration_ms: Math.round(performance.now() - t0), id: result.id, auto_links: result.auto_links.length });
        return result;
      }
      case 'knowledge_link':
        return await handleLink(storage, params.source_id, params.target_id, params.relation);
      case 'knowledge_list':
        return await handleList(storage, params.filters ?? {}, params.limit ?? 50, config.learning.decayRates);
      case 'knowledge_delete':
        return await handleDelete(storage, params.id);
      case 'knowledge_evolve': {
        onStep('start', `Evolve: ${(params.id || '').slice(0, 8)}...`);
        const t0 = performance.now();
        const result = await handleEvolve(storage, embedder, linker, params.id, params.new_content, params.new_metadata, params.reason, onStep);
        onStep('complete', `Evolved to v${result.version}`, { duration_ms: Math.round(performance.now() - t0), version: result.version });
        return result;
      }
      case 'knowledge_validate':
        return await handleValidate(storage, params.id, params.action, config.learning, params.evidence, params.context);
      case 'knowledge_promote':
        return await handlePromote(storage, params.id, params.reason, params.new_category, params.new_importance);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // ============================================================
  // HTTP server
  // ============================================================

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (path === '/rpc' && req.method === 'POST') {
        // JSON-RPC dispatch
        const body = await readBody(req);
        const rpcReq = parseRpcRequest(body);
        try {
          const result = await dispatchRpc(rpcReq.method, rpcReq.params);
          sendJson(res, formatResult(rpcReq.id, result));
        } catch (e) {
          sendJson(res, formatError(rpcReq.id, -32603, e instanceof Error ? e.message : String(e)));
        }
      } else if (path === '/rpc/connect' && req.method === 'POST') {
        clientCount++;
        resetIdleTimer();
        log(`Daemon: client connected (total: ${clientCount})`);
        sendJson(res, { ok: true, clients: clientCount });
      } else if (path === '/rpc/disconnect' && req.method === 'POST') {
        clientCount = Math.max(0, clientCount - 1);
        log(`Daemon: client disconnected (total: ${clientCount})`);
        if (clientCount <= 0) startIdleTimer();
        sendJson(res, { ok: true, clients: clientCount });
      } else if (path === '/rpc/shutdown' && req.method === 'POST') {
        log('Daemon: shutdown requested via /rpc/shutdown');
        sendJson(res, { ok: true });
        // Flush the response before shutting down
        setTimeout(() => shutdown(), 100);
      } else if (path === '/health') {
        sendJson(res, {
          status: 'ok',
          project_id: projectId,
          clients: clientCount,
          uptime_ms: Date.now() - startTime,
        });
      } else {
        // Delegate to dashboard for /api/*, /, /index.html
        dashboard.handleRequest(req, res);
      }
    } catch (e) {
      log('Daemon: request error:', path, e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });

  // Listen on configured port or auto-assign
  const portRangeStart = parseInt(process.env.KG_PORT_RANGE_START || '0', 10);
  server.listen(portRangeStart, '127.0.0.1', () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : portRangeStart;
    writeFileSync(portFile, String(actualPort));
    writeFileSync(pidFile, String(process.pid));
    log(`Daemon: listening on http://127.0.0.1:${actualPort} (project: ${projectId})`);
  });

  // ============================================================
  // Graceful shutdown
  // ============================================================

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Daemon: shutting down...');
    try {
      await dashboard.close();
      await storage.close();
      server.close();
    } catch (e) {
      log('Daemon: shutdown error:', e);
    }
    // Clean up port + pid files
    try { if (existsSync(portFile)) unlinkSync(portFile); } catch { /* ignore */ }
    try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch { /* ignore */ }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ============================================================
// Helpers
// ============================================================

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ============================================================
// Run
// ============================================================

daemonMain().catch((e) => {
  log('Daemon: fatal error:', e);
  process.exit(1);
});
