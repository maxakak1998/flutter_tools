#!/usr/bin/env node

/**
 * Daemon process — owns the KuzuDB lock, serves JSON-RPC over HTTP,
 * hosts the dashboard, and auto-shuts down after idle timeout.
 *
 * Spawned by daemon-manager.ts via child_process.fork() with detached: true.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createCore, CoreComponents } from './core.js';
import { parseRpcRequest, formatResult, formatError } from './rpc.js';
import { KnowledgeConfig } from './config.js';
import { log, setFileLogger, type DomainStatsCache } from './types.js';
import { FileLogger, parseLogLevel } from './logger.js';
import { randomUUID } from 'crypto';
import { createCacheManager } from './cache.js';
import { DashboardServer } from './dashboard/server.js';
import { handleQuery } from './tools/query.js';
import { handleStore } from './tools/store.js';
import { applyLocalhostCors, isHttpRequestError, readRequestBody } from './http-utils.js';

import { handleLink } from './tools/link.js';
import { handleList } from './tools/list.js';
import { handleDelete } from './tools/delete.js';
import { handleEvolve } from './tools/evolve.js';
import { handleValidate } from './tools/validate.js';
import { handlePromote } from './tools/promote.js';
import { handleBriefing } from './tools/briefing.js';
import { handleExport } from './tools/export.js';
import { handleIngest } from './tools/ingest.js';
import { handleLifeStore } from './tools/life-store.js';
import { handleLifeFeedback } from './tools/life-feedback.js';
import { handleLifeDraftSkill } from './tools/life-draft-skill.js';

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
    core = await createCore(config, process.env.KG_CONFIG_PATH);
  } catch (e) {
    log('Daemon: failed to initialize core:', e);
    process.exit(1);
  }

  const { storage, embedder, retriever, linker, eventBus, entityRegistry } = core;
  const cacheManager = createCacheManager(kgDir);
  cacheManager.ensureDir();

  // Startup purge: delete expired refuted operational chunks (TTL-based garbage collection)
  try {
    const ttlMs = config.operational.refutedTtlDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    const candidates = await storage.listChunks({ layer: 'operational', lifecycle: 'refuted' }, 1000);
    let purged = 0;
    for (const chunk of candidates) {
      const lastTouched = chunk.last_validated_at || chunk.updated_at;
      if (lastTouched && lastTouched <= cutoff) {
        await storage.deleteChunk(chunk.id);
        purged++;
      }
    }
    if (purged > 0) log(`Startup purge: deleted ${purged} expired operational chunks`);
  } catch (e) {
    log('Startup purge failed (non-fatal):', e);
  }

  // Initialize file logger
  const fileLogger = new FileLogger(join(kgDir, 'logs'), {
    maxBytes: config.logging.maxFileSize,
    maxFiles: config.logging.maxFiles,
    minLevel: parseLogLevel(config.logging.level),
  });
  fileLogger.init();
  setFileLogger(fileLogger);
  fileLogger.info('daemon', `Starting — project=${projectId}, port_range=${process.env.KG_PORT_RANGE_START || '0'}, idle=${idleTimeoutMs}ms`);

  const lifecycleOrder: Record<string, number> = {
    refuted: 0,
    hypothesis: 1,
    active: 2,
    validated: 3,
    promoted: 4,
    canonical: 5,
  };

  let cacheRegenTimer: ReturnType<typeof setTimeout> | null = null;

  async function regenerateDomainStatsCache(): Promise<void> {
    try {
      const [stats, allChunks] = await Promise.all([
        storage.getStats(),
        storage.listChunks({}, 5000),
      ]);
      // Exclude operational/entity-index layers from domain stats cache
      const chunks = allChunks.filter(c => c.layer !== 'operational' && c.layer !== 'entity-index');

      const domains = new Map<string, {
        name: string;
        chunk_count: number;
        top_lifecycle: string;
        confidence_sum: number;
      }>();

      for (const chunk of chunks) {
        const key = chunk.domain || 'unknown';
        const existing = domains.get(key) ?? {
          name: key,
          chunk_count: 0,
          top_lifecycle: chunk.lifecycle,
          confidence_sum: 0,
        };
        existing.chunk_count += 1;
        existing.confidence_sum += chunk.confidence;
        if ((lifecycleOrder[chunk.lifecycle] ?? -1) > (lifecycleOrder[existing.top_lifecycle] ?? -1)) {
          existing.top_lifecycle = chunk.lifecycle;
        }
        domains.set(key, existing);
      }

      const payload: DomainStatsCache = {
        domains: Array.from(domains.values())
          .map((domain) => ({
            name: domain.name,
            chunk_count: domain.chunk_count,
            top_lifecycle: domain.top_lifecycle,
            avg_confidence: domain.chunk_count > 0
              ? Math.round((domain.confidence_sum / domain.chunk_count) * 1000) / 1000
              : 0,
          }))
          .sort((a, b) => b.chunk_count - a.chunk_count || a.name.localeCompare(b.name)),
        total_chunks: stats.total_chunks,
        total_edges: stats.total_edges,
        generated_at: new Date().toISOString(),
      };

      cacheManager.write('domain-stats.json', payload);
    } catch (e) {
      log('Daemon: domain stats cache regen failed:', e);
    }
  }

  function scheduleCacheRegen(): void {
    if (cacheRegenTimer) clearTimeout(cacheRegenTimer);
    cacheRegenTimer = setTimeout(() => {
      void regenerateDomainStatsCache();
    }, 300);
  }

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
    const result = await handleStore(storage, embedder, linker, content, metadata as any, onStep, config.dedup.similarityThreshold, config.learning.hypothesisInitialConfidence, config.domains.aliases, config.domains.canonical, entityRegistry);
    scheduleCacheRegen();
    onStep('complete', `Stored ${result.id}`, { duration_ms: Math.round(performance.now() - t0), id: result.id, auto_links: result.auto_links.length });
    return result;
  });

  dashboard.registerTrigger('evolve', async (params) => {
    const { id, new_content, new_metadata, reason } = params as { id: string; new_content: string; new_metadata?: Record<string, unknown>; reason: string };
    const requestId = randomUUID();
    const onStep = eventBus.makeStepEmitter(requestId, 'evolve');
    onStep('start', `Evolve: ${id.slice(0, 8)}...`);
    const t0 = performance.now();
    const result = await handleEvolve(storage, embedder, linker, id, new_content, new_metadata as any, reason, onStep, config.domains.aliases, entityRegistry);
    scheduleCacheRegen();
    onStep('complete', `Evolved to v${result.version}`, { duration_ms: Math.round(performance.now() - t0), version: result.version });
    return result;
  });

  dashboard.registerTrigger('validate', async (params) => {
    const { id, action, evidence, context } = params as { id: string; action: 'confirm' | 'refute'; evidence?: string; context?: string };
    const result = await handleValidate(storage, id, action, config.learning, evidence, context);
    scheduleCacheRegen();
    return result;
  });

  dashboard.registerTrigger('promote', async (params) => {
    const { id, reason, new_category, new_importance } = params as { id: string; reason: string; new_category?: any; new_importance?: any };
    const result = await handlePromote(storage, id, reason, new_category, new_importance);
    scheduleCacheRegen();
    return result;
  });

  dashboard.registerTrigger('briefing', async (params) => {
    const topDomains = typeof params.top_domains === 'number' ? params.top_domains : config.briefing.topDomains;
    const recentDays = typeof params.recent_days === 'number' ? params.recent_days : config.briefing.recentDays;
    return await handleBriefing(storage, config.learning.decayRates, topDomains, recentDays, cacheManager);
  });

  dashboard.registerTrigger('ingest', async (params) => {
    const { content, source, domain_hint } = params as { content: string; source?: string; domain_hint?: string };
    const requestId = randomUUID();
    const onStep = eventBus.makeStepEmitter(requestId, 'ingest');
    onStep('start', `Ingest: ${content.slice(0, 60)}`);
    const t0 = performance.now();
    const result = await handleIngest(storage, embedder, content, source, domain_hint, config.dedup.similarityThreshold);
    onStep('complete', `${result.stats.total_segments} segments`, {
      duration_ms: Math.round(performance.now() - t0),
      total_segments: result.stats.total_segments,
      duplicates: result.stats.duplicates,
    });
    return result;
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
    const t0 = performance.now();

    try {
      let result: unknown;

      switch (method) {
        case 'knowledge_query': {
          onStep('start', `Query: "${(params.query || '').slice(0, 60)}"`);
          const qResult = await handleQuery(retriever, params.query, params.filters, onStep);
          onStep('complete', `${qResult.total} results`, { duration_ms: Math.round(performance.now() - t0), result_count: qResult.total });
          result = qResult;
          break;
        }
        case 'knowledge_store': {
          onStep('start', `Store: "${(params.metadata?.summary || '').slice(0, 50)}"`);
          const sResult = await handleStore(storage, embedder, linker, params.content, params.metadata, onStep, config.dedup.similarityThreshold, config.learning.hypothesisInitialConfidence, config.domains.aliases, config.domains.canonical, entityRegistry);
          scheduleCacheRegen();
          onStep('complete', `Stored ${sResult.id}`, { duration_ms: Math.round(performance.now() - t0), id: sResult.id, auto_links: sResult.auto_links.length });
          result = sResult;
          break;
        }
        case 'knowledge_link':
          result = await handleLink(storage, params.source_id, params.target_id, params.relation);
          break;
        case 'knowledge_list':
          result = await handleList(storage, params.filters ?? {}, params.limit ?? 50, config.learning.decayRates);
          break;
        case 'knowledge_delete': {
          result = await handleDelete(storage, params.id, params.reason);
          scheduleCacheRegen();
          break;
        }
        case 'knowledge_evolve': {
          onStep('start', `Evolve: ${(params.id || '').slice(0, 8)}...`);
          const eResult = await handleEvolve(storage, embedder, linker, params.id, params.new_content, params.new_metadata, params.reason, onStep, config.domains.aliases, entityRegistry);
          scheduleCacheRegen();
          onStep('complete', `Evolved to v${eResult.version}`, { duration_ms: Math.round(performance.now() - t0), version: eResult.version });
          result = eResult;
          break;
        }
        case 'knowledge_validate': {
          result = await handleValidate(storage, params.id, params.action, config.learning, params.evidence, params.context);
          scheduleCacheRegen();
          break;
        }
        case 'knowledge_promote': {
          result = await handlePromote(storage, params.id, params.reason, params.new_category, params.new_importance);
          scheduleCacheRegen();
          break;
        }
        case 'knowledge_briefing':
          result = await handleBriefing(
            storage,
            config.learning.decayRates,
            params.top_domains ?? config.briefing.topDomains,
            params.recent_days ?? config.briefing.recentDays,
            cacheManager,
          );
          break;
        case 'knowledge_export':
          result = await handleExport(
            storage,
            params.group_by ?? 'domain',
            params.min_lifecycle,
            params.format ?? 'markdown',
            params.include_content ?? true,
            config.learning.decayRates,
          );
          break;
        case 'knowledge_ingest': {
          onStep('start', `Ingest: ${(params.content || '').slice(0, 60)}`);
          const iResult = await handleIngest(
            storage,
            embedder,
            params.content,
            params.source,
            params.domain_hint,
            config.dedup.similarityThreshold,
          );
          onStep('complete', `${iResult.stats.total_segments} segments`, {
            duration_ms: Math.round(performance.now() - t0),
            total_segments: iResult.stats.total_segments,
            duplicates: iResult.stats.duplicates,
          });
          result = iResult;
          break;
        }
        // Life Knowledge tools (operational layer)
        case 'life_store': {
          onStep('start', `Life store: "${(params.metadata?.summary || '').slice(0, 50)}"`);
          const lsResult = await handleLifeStore(storage, embedder, linker, config, params.content, params.metadata, onStep);
          scheduleCacheRegen();
          onStep('complete', `Stored ${lsResult.id} (score ${lsResult.score})`, { duration_ms: Math.round(performance.now() - t0), id: lsResult.id });
          result = lsResult;
          break;
        }
        case 'life_feedback': {
          result = await handleLifeFeedback(storage, params.id, params.outcome, params.context);
          scheduleCacheRegen();
          break;
        }
        case 'life_draft_skill': {
          result = await handleLifeDraftSkill(storage, config, params.domain, params.target_skill_path, params.force);
          scheduleCacheRegen();
          break;
        }
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      const ms = Math.round(performance.now() - t0);
      fileLogger.info('rpc', `${method} OK (${ms}ms)`);
      return result;
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      fileLogger.error('rpc', `${method} FAIL (${ms}ms): ${e instanceof Error ? e.message : String(e)}`, {
        stack: e instanceof Error ? e.stack : undefined,
      });
      throw e;
    }
  }

  // ============================================================
  // HTTP server
  // ============================================================

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (!applyLocalhostCors(req, res)) {
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (path === '/rpc' && req.method === 'POST') {
        // JSON-RPC dispatch
        const body = await readRequestBody(req);
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
      if (isHttpRequestError(e)) {
        res.writeHead(e.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        return;
      }
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
    fileLogger.info('daemon', `Shutting down — uptime=${Math.round((Date.now() - startTime) / 1000)}s, clients=${clientCount}`);
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
