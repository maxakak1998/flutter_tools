import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { readFileSync } from 'fs';
import { exec, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KuzuStorage } from '../storage/kuzu.js';
import { Embedder } from '../engine/embedder.js';
import { Retriever } from '../engine/retriever.js';
import { EventBus } from './events.js';
import { handleGraphData, handleStats, handleChunkDetail, handleSearch } from './api.js';
import { log } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TriggerHandler = (params: Record<string, unknown>) => Promise<unknown>;

export class DashboardServer {
  private server: Server | null = null;
  private html: string;
  private triggers = new Map<string, TriggerHandler>();

  constructor(
    private storage: KuzuStorage,
    private embedder: Embedder,
    private retriever: Retriever,
    private eventBus: EventBus,
  ) {
    // Read HTML at startup — single file, no hot reload needed
    this.html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
  }

  /** Register an HTTP POST trigger (e.g., 'query', 'store', 'evolve') */
  registerTrigger(name: string, handler: TriggerHandler): void {
    this.triggers.set(name, handler);
  }

  start(port: number, openBrowser = false): void {
    this.listen(port, true, openBrowser);
  }

  private listen(port: number, allowRetry: boolean, openBrowser: boolean): void {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        if (allowRetry && this.killOurProcess(port)) {
          log(`Dashboard: killed stale process on port ${port}, retrying...`);
          setTimeout(() => this.listen(port, false, openBrowser), 500);
        } else {
          log(`Dashboard: port ${port} in use by another service — dashboard disabled`);
          this.server = null;
        }
      } else {
        log('Dashboard error:', err);
      }
    });
    this.server.listen(port, () => {
      log(`Dashboard: http://localhost:${port}`);
      if (openBrowser) {
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} http://localhost:${port}`, () => {});
      }
    });
  }

  /** Kill a previous knowledge-graph process holding the port. Returns true if killed. */
  private killOurProcess(port: number): boolean {
    try {
      const output = execSync(
        `lsof -i :${port} -sTCP:LISTEN -P -n 2>/dev/null`,
        { encoding: 'utf-8', timeout: 3000 },
      ).trim();
      for (const line of output.split('\n').slice(1)) {
        const parts = line.split(/\s+/);
        const command = parts[0] || '';
        const pid = parseInt(parts[1] || '', 10);
        if (!pid || pid === process.pid) continue;
        // Only kill node processes running our CLI
        if (command === 'node') {
          try {
            const cmdline = execSync(`ps -p ${pid} -o args= 2>/dev/null`, {
              encoding: 'utf-8',
              timeout: 3000,
            }).trim();
            if (cmdline.includes('knowledge-graph') || cmdline.includes('cli.js')) {
              process.kill(pid, 'SIGTERM');
              log(`Dashboard: sent SIGTERM to stale PID ${pid}`);
              return true;
            }
          } catch { /* process may have already exited */ }
        }
      }
    } catch { /* lsof not available or failed */ }
    return false;
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
        const data = await handleGraphData(this.storage, this.embedder);
        this.sendJson(res, data);
      } else if (path === '/api/stats') {
        const data = await handleStats(this.storage, this.embedder);
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
        const data = await handleSearch(this.retriever, q, Object.keys(filters).length > 0 ? filters as any : undefined);
        this.sendJson(res, data);
      } else if (path.startsWith('/api/chunks/')) {
        const id = path.replace('/api/chunks/', '');
        const data = await handleChunkDetail(this.storage, id);
        if (data) {
          this.sendJson(res, data);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Chunk not found' }));
        }
      } else if (path === '/api/events') {
        this.eventBus.subscribe(res);
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
        const body = await this.readBody(req);
        const params = JSON.parse(body || '{}');
        const result = await handler(params);
        this.sendJson(res, result);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (e) {
      log('Dashboard request error:', path, e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, data: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
