import { IncomingMessage, ServerResponse } from 'http';

export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

const ALLOWED_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export class HttpRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export function isAllowedLocalOrigin(origin?: string): boolean {
  if (!origin) return true;

  try {
    const url = new URL(origin);
    return ALLOWED_LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function applyLocalhostCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;

  if (origin) {
    if (!isAllowedLocalOrigin(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Origin not allowed' }));
      return false;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

export async function readRequestBody(
  req: IncomingMessage,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<string> {
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    const declaredSize = parseInt(contentLength, 10);
    if (!Number.isNaN(declaredSize) && declaredSize > maxBytes) {
      throw new HttpRequestError(413, `Request body too large (max ${maxBytes} bytes)`);
    }
  }

  let totalBytes = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new HttpRequestError(413, `Request body too large (max ${maxBytes} bytes)`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf-8');
}

export function isHttpRequestError(error: unknown): error is HttpRequestError {
  return error instanceof HttpRequestError;
}
