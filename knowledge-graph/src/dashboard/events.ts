import { ServerResponse } from 'http';
import { DashboardEvent, StepEmitter, log } from '../types.js';
import { isAllowedLocalOrigin } from '../http-utils.js';

const MAX_BUFFER = 200;

export class EventBus {
  private clients: Set<ServerResponse> = new Set();
  private buffer: DashboardEvent[] = [];

  /** Emit a full event to all SSE clients and buffer it. */
  emit(event: DashboardEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(-MAX_BUFFER);
    }

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /** Convenience: emit a step event for a specific request. */
  step(requestId: string, tool: string, step: string, summary: string, data?: unknown): void {
    this.emit({
      id: requestId,
      timestamp: new Date().toISOString(),
      tool,
      step,
      summary,
      data,
    });
  }

  /** Create a StepEmitter bound to a specific requestId and tool name. */
  makeStepEmitter(requestId: string, tool: string): StepEmitter {
    return (step: string, summary: string, data?: unknown) => {
      this.step(requestId, tool, step, summary, data);
    };
  }

  /** Subscribe an SSE client. Sends initial backfill of recent events. */
  subscribe(reqOrigin: string | undefined, res: ServerResponse): void {
    if (reqOrigin && !isAllowedLocalOrigin(reqOrigin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Origin not allowed' }));
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };

    if (reqOrigin) {
      headers['Access-Control-Allow-Origin'] = reqOrigin;
      headers['Vary'] = 'Origin';
    }

    res.writeHead(200, headers);

    // Send recent events as backfill
    for (const event of this.buffer) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    this.clients.add(res);

    // Remove client on close
    res.on('close', () => {
      this.clients.delete(res);
    });

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        this.clients.delete(res);
      }
    }, 30000);

    res.on('close', () => clearInterval(keepAlive));
  }

  /** Get recent events for initial page load API. */
  getRecent(): DashboardEvent[] {
    return [...this.buffer];
  }

  /** Number of connected SSE clients. */
  get clientCount(): number {
    return this.clients.size;
  }
}
