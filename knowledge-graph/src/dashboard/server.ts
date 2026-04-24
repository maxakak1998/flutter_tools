import { IncomingMessage, ServerResponse, Server } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { IStorage } from '../storage/interface.js';
import { Embedder } from '../engine/embedder.js';
import { Retriever } from '../engine/retriever.js';
import { EventBus } from './events.js';
import { handleGraphData, handleStats, handleChunkDetail, handleSearch } from './api.js';
import { log } from '../types.js';
import { applyLocalhostCors, isHttpRequestError, readRequestBody } from '../http-utils.js';
import { AsyncMutex } from '../async-mutex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TriggerHandler = (params: Record<string, unknown>) => Promise<unknown>;

export class DashboardServer {
  private server: Server | null = null;
  private html: string;
  private triggers = new Map<string, TriggerHandler>();
  private rpcMutex: AsyncMutex | null;

  constructor(
    private storage: IStorage,
    private embedder: Embedder,
    private retriever: Retriever,
    private eventBus: EventBus,
    rpcMutex?: AsyncMutex,
  ) {
    this.rpcMutex = rpcMutex ?? null;
    // Read HTML at startup — single file, no hot reload needed
    this.html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
  }

  /** Register an HTTP POST trigger (e.g., 'query', 'store', 'evolve') */
  registerTrigger(name: string, handler: TriggerHandler): void {
    this.triggers.set(name, handler);
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      if (path === '/' || path === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.html);
      } else if (path === '/api/graph') {
        const data = await this.guarded(() => handleGraphData(this.storage));
        this.sendJson(res, data);
      } else if (path === '/api/stats') {
        const data = await this.guarded(() => handleStats(this.storage, this.embedder));
        this.sendJson(res, data);
      } else if (path === '/api/search') {
        const q = url.searchParams.get('q') || '';
        if (!q) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required query parameter: q' }));
          return;
        }
        const filters: Record<string, unknown> = {};
        const domain = url.searchParams.get('domain');
        const category = url.searchParams.get('category');
        const importance = url.searchParams.get('importance');
        const limitParam = url.searchParams.get('limit');
        if (domain) filters.domain = domain;
        if (category) filters.category = category;
        if (importance) filters.importance = importance;
        if (limitParam) filters.limit = parseInt(limitParam, 10);
        const data = await this.guarded(() => handleSearch(this.retriever, q, Object.keys(filters).length > 0 ? filters as any : undefined));
        this.sendJson(res, data);
      } else if (path.startsWith('/api/chunks/')) {
        const id = path.replace('/api/chunks/', '');
        const data = await this.guarded(() => handleChunkDetail(this.storage, id));
        if (data) {
          this.sendJson(res, data);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Chunk not found' }));
        }
      } else if (path === '/api/events') {
        this.eventBus.subscribe(req.headers.origin, res);
      } else if (path === '/api/health') {
        this.sendJson(res, {
          status: 'ok',
          sse_clients: this.eventBus.clientCount,
        });
      } else if (path === '/api/recent') {
        this.sendJson(res, this.eventBus.getRecent());
      } else if (req.method === 'POST' && path.startsWith('/api/trigger/')) {
        const name = path.replace('/api/trigger/', '');
        const handler = this.triggers.get(name);
        if (!handler) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown trigger: ${name}` }));
          return;
        }
        const body = await readRequestBody(req);
        const params = JSON.parse(body || '{}');
        const result = await this.guarded(() => handler(params));
        this.sendJson(res, result);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (e) {
      log('Dashboard request error:', path, e);
      if (isHttpRequestError(e)) {
        res.writeHead(e.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
  }

  /** Run fn through the RPC mutex if available, otherwise run directly. */
  private guarded<T>(fn: () => Promise<T>): Promise<T> {
    return this.rpcMutex ? this.rpcMutex.runExclusive(fn) : fn();
  }

  private sendJson(res: ServerResponse, data: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
