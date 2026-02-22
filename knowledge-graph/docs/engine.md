# Layer 3: Knowledge Engine

The engine layer (`src/engine/`) contains three components: Embedder, Retriever, and Linker. All receive configuration via constructor injection from `config.ts` values.

---

## Embedder (`engine/embedder.ts`)

All Ollama settings are injected via constructor from config:

```typescript
constructor(
  ollamaUrl = DEFAULT_CONFIG.ollama.url,       // from config.ts
  model = DEFAULT_CONFIG.ollama.model,          // from config.ts
  cacheSize = DEFAULT_CONFIG.cache.embeddingCacheSize,  // from config.ts
)
```

### Ollama Integration

Calls `POST {ollamaUrl}/api/embed` with the configured model. bge-m3 produces **1024-dimensional** vectors.

```
Request:  POST /api/embed { model: "bge-m3", input: "text" }
Response: { embeddings: [number[1024]] }
```

For batch: pass `input: ["text1", "text2", ...]` — returns `embeddings: [vec1, vec2, ...]`.

### SHA256 Embedding Cache (LRU)

In-memory LRU cache keyed by SHA256 hash of the input text. Prevents redundant Ollama API calls for repeated texts. Max size is configurable via `cache.embeddingCacheSize` (default: 10,000 entries). Evicts oldest entries when full.

```
text → SHA256 hash → LRU cache lookup → hit? return cached : call Ollama → cache result → evict if over capacity
```

### Batch Embedding

`embedBatch(texts)` checks cache for each text first, then sends only uncached texts to Ollama in a single API call. Results are mapped back to original indices.

### Health Check

`GET {ollamaUrl}/api/tags` — checks Ollama is running and the configured model is available. Called at server startup. Non-blocking: server starts even if health check fails.

---

## Retriever (`engine/retriever.ts`)

Default query limit injected via constructor from `search.defaultLimit` config.

### 7-Step Hybrid Search Pipeline

```
Query → [1] Embed → [2] Vector Search → [3] Extract Terms
                                      → [4] Graph Expand
      → [5] Merge & Score → [6] MMR Rerank → [7] Enrich Code Links
```

**Step 1 — Embed query**: Call `embedder.embed(query)`. If embedding fails, fall back to keyword-only search.

**Step 2 — Vector search**: `storage.vectorSearch(embedding, limit*2)`. Fetches extra candidates for reranking. Uses KuzuDB HNSW index with cosine metric. Post-filters by domain/category/importance/tags.

**Step 3 — Extract terms**: Lowercase, remove non-alphanumeric (except underscores), split on whitespace, filter terms ≤2 chars, deduplicate.

**Step 4 — Graph expansion**: Take top 3 vector hits. For each, traverse `RELATES_TO|DEPENDS_ON|CONTRADICTS|SUPERSEDES` relationships at depth 1. Collect related chunk IDs.

**Step 5 — Merge and score**: Combine all candidates with weighted scoring:

| Signal | Weight | Score Source |
|--------|--------|-------------|
| Vector similarity | 0.6 | `1 - cosine_distance` |
| Keyword/entity match | 0.2 | `computeKeywordScore()` |
| Graph connection | 0.2 | Flat 0.2 if already in results, 0.15 if graph-only |

**Step 6 — MMR rerank**: Maximal Marginal Relevance reranking for diversity. Iteratively selects chunks that are both high-scoring AND dissimilar to already-selected chunks (λ=0.7 favoring relevance). Candidates without embeddings (graph-only hits) are appended after MMR selection.

**Step 7 — Enrich with code links**: For each result chunk, fetch `IMPLEMENTED_BY`, `TESTED_BY`, `DEMONSTRATED_IN` relationships to CodeEntity nodes. Return as `code_links[]` with `name:line` format for paths.

### Keyword Scoring Algorithm

`computeKeywordScore(chunk, queryTerms)`:

1. Build a set from: chunk keywords + entities + tags + domain (all lowercase)
2. For each query term:
   - **Exact match** in set: +0.3
   - **Partial match** (substring either direction): +0.1
3. Cap total at 1.0

### Keyword-Only Fallback

When embedding fails (Ollama down), the retriever:
1. Extract terms from query
2. Search first 5 terms via `storage.findChunksByKeyword()`
3. Deduplicate, apply filters
4. Score by keyword algorithm
5. Boost +0.1 for each additional term that matches

### Error Handling

- Embedding failure: falls back to keyword-only search
- Graph traversal failure: caught per-hit, skipped (handles isolated nodes)

---

## Linker (`engine/linker.ts`)

Similarity threshold and auto-link candidate count injected via constructor from `search.similarityThreshold` and `search.autoLinkTopK` config values.

### Auto-Linking (Vector Similarity)

When a new chunk is stored:
1. Vector search for top `autoLinkTopK + 1` similar chunks (default: 6)
2. Exclude self
3. For each with `similarity >= similarityThreshold` (default: 0.82):
   - Create `RELATES_TO` edge with `auto_created: 'true'` property

### Suggested Relations Matching

For each `suggested_relation` from Claude's metadata, find the best matching chunk:

```
1. Domain match:    findChunksByDomain(concept)    → score 0.9
2. Keyword match:   findChunksByKeyword(concept)   → score 0.7
3. Embedding match: embed(concept) → vectorSearch  → score = similarity (≥0.5)
4. No match:        skip
```

If matched, create the specified relationship type (relates_to, depends_on, contradicts).

### Relink After Evolve

`relinkChunk()` first deletes all auto-created `RELATES_TO` edges (via `storage.deleteAutoRelations()`), then re-runs `autoLink()` with the new embedding. Manually-created links are preserved.

### Error Handling

- Auto-link failure: logged, skipped (non-fatal)
- findBestMatch failures: caught per-strategy, tries next strategy
