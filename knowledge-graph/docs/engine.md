# Layer 3: Knowledge Engine

The engine layer (`src/engine/`) contains four modules: Embedder, Retriever, Linker, and Confidence. The first three are class-based components that receive configuration via constructor injection from `config.ts` values. Confidence provides pure utility functions used by Retriever, List, and Validate handlers.

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

### Hybrid Search Pipeline

```
Query → [1] Embed → [2] Vector Search → [3] Extract Terms
                                      → [4] Graph Expand
      → [5] Merge & Score (vector + keyword + graph + confidence)
      → [6] Sort, Filter & Return
```

**Step 1 — Embed query**: Call `embedder.embed(query)`. If embedding fails, fall back to keyword-only search.

**Step 2 — Vector search**: `storage.vectorSearch(embedding, 50, filters)`. Fetches 50 candidates from HNSW index with cosine metric. Applies filters (domain/category/importance/layer/tags/min_confidence/lifecycle/since) at the storage layer — note that `min_confidence` here filters on **raw** stored confidence, not effective (decayed) confidence. The retriever applies a second `min_confidence` filter on **effective** confidence in Step 6. Since temporal decay only reduces confidence, the raw filter is always less restrictive than the effective filter, so the double filtering is redundant but not harmful.

**Step 3 — Extract terms**: Lowercase, remove non-alphanumeric (except underscores), split on whitespace, filter out terms ≤2 chars (keep only >2 chars), deduplicate.

**Step 4 — Graph expansion**: Take top 3 vector hits. For each, traverse all 15 relationship types at depth 1. Collect related chunk IDs.

**Step 5 — Merge and score**: Combine all candidates with weighted scoring:

| Signal | Weight | Score Source |
|--------|--------|-------------|
| Vector similarity | 0.55 | `1 - cosine_distance` |
| Keyword/entity match | 0.2 | `computeKeywordScore()` |
| Graph connection | 0.2 | Flat 0.2 if already in results, 0.15 if graph-only |
| Confidence boost | configurable (default 0.1) | `(effective_confidence - 0.5) * confidenceSearchWeight` |

**Step 6 — Sort, filter, and return**: Sort by score descending. Filter out refuted chunks (unless explicitly requested). Apply post-filters (min_confidence on effective/decayed confidence, lifecycle, since). Track access counts for returned chunks.

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
5. Boost +0.1 per duplicate hit across keyword searches (same chunk found by multiple terms)

### Error Handling

- Embedding failure: falls back to keyword-only search
- Graph traversal failure: caught per-hit, skipped (handles isolated nodes)

### Retriever Constants

| Parameter | Value | Source |
|-----------|-------|--------|
| Vector candidate pool (HNSW) | 50 | `retriever.ts` |
| Graph expansion sources | top 3 vector hits | `retriever.ts` |
| Graph traversal depth | 1 hop | `retriever.ts` |
| Keyword-only fallback terms | first 5 | `retriever.ts` |
| Score: vector weight | 0.55 | `retriever.ts` |
| Score: keyword weight | 0.2 | `retriever.ts` |
| Score: graph weight | 0.2 (in vector results), 0.15 (graph-only) | `retriever.ts` |
| Score: confidence weight | 0.1 | `config.ts` |
| Keyword exact match boost | +0.3 | `retriever.ts` |
| Keyword partial match boost | +0.1 | `retriever.ts` |
| Keyword score cap | 1.0 | `retriever.ts` |
| Term min length | 3 chars | `retriever.ts` |

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

For each `suggested_relation` from Claude's metadata, find the best matching chunk. Tries strategies in order and creates the edge on the first successful match:

```
1. Domain match:    findChunksByDomain(concept)    → score 0.9
2. Keyword match:   findChunksByKeyword(concept)   → score 0.7
3. Embedding match: embed(concept) → vectorSearch  → score = similarity (≥0.5)
4. No match:        skip
```

If matched, create the specified relationship type (e.g., relates_to, depends_on, contradicts).

### Relink After Evolve

`relinkChunk()` first deletes all auto-created `RELATES_TO` edges (via `storage.deleteAutoRelations()`), then re-runs `autoLink()` with the new embedding. Manually-created links are preserved.

Note: Only vector-similarity RELATES_TO edges carry `auto_created: 'true'`. Edges created via suggested_relations matching have no properties set and are treated like manual links — they persist across `relinkChunk()` and are not refreshed on evolve.

### Error Handling

- Auto-link failure: logged, skipped (non-fatal)
- findBestMatch failures: caught per-strategy, tries next strategy

---

## Confidence (`engine/confidence.ts`)

Pure functions for confidence computation. No side effects — used by `validate.ts` (on confirm/refute) and by `retriever.ts` + `list.ts` (query-time temporal decay).

### Confirmation (Diminishing Returns)

Each confirmation boosts confidence, but successive confirmations have less impact:

```
decay_factor = 1 / (1 + 0.3 * validation_count)
new_confidence = min(1.0, old + boost * decay_factor)
```

Where `validation_count` is the count **before** the current action. With the default `boost` of 0.25: 1st confirm +0.25, 5th +0.11, 10th +0.07.

### Refutation (Amplifying Impact)

Each refutation reduces confidence, and successive refutations hit harder:

```
amplify_factor = 1 + 0.1 * refutation_count
new_confidence = max(0.0, old - penalty * amplify_factor)
```

Where `refutation_count` is the count **before** the current action. With the default `penalty` of 0.15: 1st refute -0.15, 5th -0.21, 10th -0.29.

### Temporal Decay

Computed at query/list time, NOT stored. Only applies when `last_validated_at` is set:

```
months_since = (now - last_validated_at) / 30_days
effective_confidence = confidence * decay_rate^months_since
```

Per-category decay rates (configurable via `learning.decayRates`):

| Category | Rate | Effect |
|----------|------|--------|
| `fact` | 1.0 | No decay |
| `rule` | 1.0 | No decay |
| `insight` | 0.95 | 5% monthly decay |
| `question` | 0.90 | 10% monthly decay |
| `workflow` | 0.98 | 2% monthly decay |

### Consumers

| Consumer | Function Used | When |
|----------|--------------|------|
| `validate.ts` | `computeConfirmation`, `computeRefutation` | On confirm/refute action |
| `retriever.ts` | `computeDecay` | Confidence boost during search scoring |
| `list.ts` | `computeDecay` | Effective confidence in list results |
