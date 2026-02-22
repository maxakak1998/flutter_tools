import { createHash } from 'crypto';
import { EMBEDDING_DIMENSIONS, log } from '../types.js';
import { DEFAULT_CONFIG } from '../config.js';

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

    const response = await fetch(`${this.ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (body.includes('not found')) {
        throw new Error(`Model ${this.model} not found. Run: ollama pull ${this.model}`);
      }
      throw new Error(`Ollama embed failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    const embedding = data.embeddings[0];

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

    const response = await fetch(`${this.ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: uncachedTexts }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (body.includes('not found')) {
        throw new Error(`Model ${this.model} not found. Run: ollama pull ${this.model}`);
      }
      throw new Error(`Ollama embed batch failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };

    for (let i = 0; i < uncachedIndices.length; i++) {
      const embedding = data.embeddings[i];
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
