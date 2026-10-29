import { createHash } from 'crypto';
import { EMBEDDING_DIMENSIONS, log } from '../types.js';
import { DEFAULT_CONFIG } from '../config.js';

/**
 * Per-attempt ceiling for a single Ollama /api/embed call. Node `fetch` has no
 * default timeout, so without this an unresponsive Ollama (version-skewed runner,
 * unmounted model volume) hangs the call — and thus the daemon's RPC mutex —
 * forever. Sized generously: an external-volume cold-load of bge-m3 was measured
 * at ~29s, so 60s leaves headroom while still bounding a true hang.
 */
const EMBED_TIMEOUT_MS = 60_000;

/**
 * LRU cache using Map insertion order.
 * Map iterates in insertion order; deleting and re-inserting moves an entry to the end.
 * Eviction removes from the front (oldest).
 */
class LRUCache<K, V> {
  private map = new Map<K, V>();

  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // If key already exists, delete first to refresh position
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    // Evict oldest if over capacity
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value!;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

export class Embedder {
  private ollamaUrl: string;
  private model: string;
  private cache: LRUCache<string, number[]>;
  private cacheMaxSize: number;
  /** In-flight embed requests, keyed by text hash. Prevents duplicate Ollama calls for the same text. */
  private inflight = new Map<string, Promise<number[]>>();

  constructor(
    ollamaUrl = DEFAULT_CONFIG.ollama.url,
    model = DEFAULT_CONFIG.ollama.model,
    cacheSize = DEFAULT_CONFIG.cache.embeddingCacheSize,
  ) {
    this.ollamaUrl = ollamaUrl;
    this.model = model;
    this.cacheMaxSize = cacheSize;
    this.cache = new LRUCache(cacheSize);
  }

  /** Embed a single text string into a number[1024] vector */
  async embed(text: string): Promise<number[]> {
    const hash = createHash('sha256').update(text).digest('hex');
    const cached = this.cache.get(hash);
    if (cached) return cached;

    // Coalesce: if the same text is already being embedded, await that promise
    const existing = this.inflight.get(hash);
    if (existing) return existing;

    const promise = this.doEmbed(text, hash);
    this.inflight.set(hash, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(hash);
    }
  }

  /**
   * POST to Ollama /api/embed with bounded retry.
   *
   * Ollama returns transient 5xx / EOF errors under load (e.g. during a large
   * import) and `fetch` itself rejects on connection resets. Both are retried
   * with exponential backoff. A `not found` model error and any 4xx are permanent
   * — they throw immediately without retry, since retrying can never fix them.
   *
   * Each attempt is bounded by EMBED_TIMEOUT_MS. Node's `fetch` has NO default
   * timeout: if Ollama accepts the TCP connection but never sends a response body
   * (observed when a `brew` upgrade leaves the runner on a mismatched version, or
   * when the model store lives on an external volume that unmounted), the await
   * hangs forever. Because every RPC handler runs under the daemon's single
   * AsyncMutex, one hung embed holds the lock indefinitely and stalls EVERY later
   * RPC — including non-embedding state_* calls. The AbortSignal converts that
   * silent infinite hang into a timeout rejection that flows through the retry/throw
   * path below, releasing the lock (fail-fast instead of whole-daemon deadlock).
   */
  private async embedFetch(input: string | string[], label: string): Promise<number[][]> {
    const maxAttempts = 3;
    const backoffMs = [250, 500, 1000];
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.ollamaUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, input }),
          signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body = await response.text();
          // Permanent: missing model — no amount of retry helps.
          if (body.includes('not found')) {
            throw new Error(`Model ${this.model} not found. Run: ollama pull ${this.model}`);
          }
          // Permanent: 4xx is a bad request; only 5xx is worth retrying.
          if (response.status < 500) {
            throw new Error(`Ollama ${label} failed: ${response.status} ${body}`);
          }
          lastErr = new Error(`Ollama ${label} failed: ${response.status} ${body}`);
        } else {
          const data = (await response.json()) as { embeddings: number[][] };
          return data.embeddings;
        }
      } catch (e) {
        // A thrown Error with "not found" / 4xx message above is permanent — rethrow.
        if (e instanceof Error && (e.message.includes('not found') || /failed: 4\d\d/.test(e.message))) {
          throw e;
        }
        // AbortSignal.timeout rejects with a TimeoutError (a DOMException, which is
        // NOT `instanceof Error` in Node). Normalize it to an Error whose message
        // carries "Ollama embed" so (a) the final throw below preserves it and
        // (b) client.ts classifyError tags it `ollama_failed` (retryable) rather
        // than the catch-all `internal` (no-retry). Treated as transient → retried.
        const isTimeout =
          (e as { name?: string })?.name === 'TimeoutError' ||
          (e as { name?: string })?.name === 'AbortError';
        lastErr = isTimeout
          ? new Error(`Ollama ${label} timed out after ${EMBED_TIMEOUT_MS}ms (backend unresponsive)`)
          : e; // network reject (EOF/ECONNRESET) or a 5xx captured above
      }

      // Backoff before the next attempt (skip after the final one).
      if (attempt < maxAttempts - 1) {
        const wait = backoffMs[attempt];
        log(`Ollama ${label} attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Ollama ${label} failed after ${maxAttempts} attempts`);
  }

  /** Internal: perform the actual Ollama embed call and cache the result. */
  private async doEmbed(text: string, hash: string): Promise<number[]> {
    const embeddings = await this.embedFetch(text, 'embed');
    const embedding = embeddings[0];

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      log(`Warning: expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}`);
    }

    this.cache.set(hash, embedding);
    return embedding;
  }

  /** Embed multiple texts in one call (batch). Returns embeddings in same order as input. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const hash = createHash('sha256').update(texts[i]).digest('hex');
      const cached = this.cache.get(hash);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    if (uncachedTexts.length === 0) return results;

    const embeddings = await this.embedFetch(uncachedTexts, 'embed batch');

    for (let i = 0; i < uncachedIndices.length; i++) {
      const embedding = embeddings[i];
      const hash = createHash('sha256').update(uncachedTexts[i]).digest('hex');
      this.cache.set(hash, embedding);
      results[uncachedIndices[i]] = embedding;
    }

    return results;
  }

  /** Health check: verify Ollama is running and the configured model is available */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) {
        return { ok: false, error: 'Ollama not responding' };
      }
      const data = (await response.json()) as { models: Array<{ name: string }> };
      const hasModel = data.models.some((m) => m.name.startsWith(this.model));
      if (!hasModel) {
        return { ok: false, error: `${this.model} model not found. Run: ollama pull ${this.model}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: `Ollama not available at ${this.ollamaUrl}. Start Ollama first.` };
    }
  }

  getCacheStats(): { size: number; maxSize: number } {
    return { size: this.cache.size, maxSize: this.cacheMaxSize };
  }
}
