// === Chunk Metadata — what Claude provides when storing knowledge ===

export interface ChunkMetadata {
  summary: string;
  keywords: string[];
  domain: string;
  category: ChunkCategory;
  importance: Importance;
  layer?: ChunkLayer;
  entities?: string[];
  suggested_relations?: SuggestedRelation[];
  tags?: string[];
  source?: string;
}

export type ChunkLayer = 'core-knowledge' | 'learning' | 'procedural' | string;

export type ChunkCategory =
  | 'fact'
  | 'rule'
  | 'insight'
  | 'question'
  | 'workflow';

export type ChunkLifecycle =
  | 'hypothesis'
  | 'validated'
  | 'promoted'
  | 'canonical'
  | 'refuted'
  | 'active';

export type Importance = 'critical' | 'high' | 'medium' | 'low';

export type KnowledgeRelation =
  | 'relates_to'
  | 'depends_on'
  | 'contradicts'
  | 'supersedes'
  | 'triggers'
  | 'requires'
  | 'produces'
  | 'is_part_of'
  | 'constrains'
  | 'precedes'
  | 'transitions_to'
  | 'governed_by';

export interface SuggestedRelation {
  concept: string;
  relation: 'relates_to' | 'depends_on' | 'contradicts' | 'triggers' | 'requires' | 'produces' | 'is_part_of' | 'constrains' | 'precedes' | 'transitions_to' | 'governed_by';
}

// === Stored types (what lives in KuzuDB) ===

export interface StoredChunk {
  id: string;
  content: string;
  summary: string;
  embedding: number[];
  source: string | null;
  category: string;
  domain: string;
  importance: string;
  layer: string | null;
  keywords: string[];
  entities: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  version: number;
  confidence: number;
  validation_count: number;
  refutation_count: number;
  last_validated_at: string;
  lifecycle: string;
  access_count: number;
}

// === Tool result types ===

export interface QueryResult {
  chunks: QueryChunk[];
  total: number;
}

export interface QueryChunk {
  id: string;
  content: string;
  metadata: ChunkMetadata & {
    version: number;
    created_at: string;
    updated_at: string;
    confidence: number;
    lifecycle: string;
    validation_count: number;
    access_count: number;
  };
  score: number;
}

export interface StoreResult {
  id: string;
  auto_links: AutoLink[];
  warnings: string[];
  duplicate_of?: string;
  similarity?: number;
  existing_summary?: string;
  existing_content?: string;
  action_hint?: string;
  related_knowledge?: Array<{
    id: string;
    summary: string;
    confidence: number;
    lifecycle: string;
    similarity: number;
    relation_hint: 'similar' | 'loosely_related';
  }>;
}

export interface AutoLink {
  target_id: string;
  relation: string;
  score: number;
}

export interface LinkResult {
  created: boolean;
  source_id: string;
  target_id: string;
  relation: string;
}

export interface EvolveResult {
  id: string;
  version: number;
  reason: string;
  superseded_id: string;
  note: string;
}

export interface ValidateResult {
  id: string;
  action: 'confirmed' | 'refuted';
  confidence: number;
  validation_count: number;
  refutation_count: number;
  lifecycle: string;
  auto_promoted: boolean;
  promotion_details?: { reason: string };
}

export interface DeleteResult {
  deleted: boolean;
  id: string;
}

export interface ListResult {
  chunks: Array<{
    id: string;
    summary: string;
    domain: string;
    category: string;
    importance: string;
    layer: string | null;
    source: string | null;
    version: number;
    updated_at: string;
    tags: string[];
    confidence: number;
    effective_confidence: number;
    lifecycle: string;
    validation_count: number;
    access_count: number;
    last_validated_at: string;
  }>;
  total: number;
}

export interface PromoteResult {
  id: string;
  previous_category: string;
  new_category: string;
  previous_lifecycle: string;
  new_lifecycle: string;
  confidence: number;
  reason: string;
}

// === Filter types ===

export interface QueryFilters {
  domain?: string;
  category?: string;
  importance?: string;
  tags?: string[];
  layer?: string;
  min_confidence?: number;
  lifecycle?: string;
  since?: string;
}

export interface ListFilters {
  domain?: string;
  category?: string;
  importance?: string;
  tags?: string[];
  source?: string;
  layer?: string;
  min_confidence?: number;
  lifecycle?: string;
  since?: string;
}

// === Constants ===

// Embedding dimensions for bge-m3 model (tied to DB schema — do not change without migration)
export const EMBEDDING_DIMENSIONS = 1024;

// === Knowledge relation type to KuzuDB table name mapping ===

export const RELATION_TABLE_MAP: Record<string, string> = {
  relates_to: 'RELATES_TO',
  depends_on: 'DEPENDS_ON',
  contradicts: 'CONTRADICTS',
  supersedes: 'SUPERSEDES',
  triggers: 'TRIGGERS',
  requires: 'REQUIRES',
  produces: 'PRODUCES',
  is_part_of: 'IS_PART_OF',
  constrains: 'CONSTRAINS',
  precedes: 'PRECEDES',
  transitions_to: 'TRANSITIONS_TO',
  governed_by: 'GOVERNED_BY',
};

// === Dashboard types ===

/** Granular event emitted for each pipeline step — drives dashboard animations. */
export interface DashboardEvent {
  id: string;           // UUID for the REQUEST (all steps of one request share this)
  timestamp: string;    // ISO 8601
  tool: string;         // 'store' | 'query' | 'evolve' | 'link' | ...
  step: string;         // store: embedding, embedding_done, dedup_check, dedup_hit, stored, auto_link, auto_link_done
                        // query: embedding, embedding_done, vector_search, keyword_extract, graph_expand, graph_expand_done, score_merge, final_rank
                        // evolve: fetch, archive, archive_done, re_embed, re_embed_done, update, update_done, re_link, re_link_done
  summary: string;      // Human-readable for this step
  data?: unknown;       // Step-specific payload for animation
  duration_ms?: number; // Time for this step (or total on 'complete')
}

/** Edge representation for graph visualization. */
export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
  from_table: string;
  to_table: string;
  auto_created?: boolean;
}

/** Aggregate stats for the dashboard. */
export interface StorageStats {
  total_chunks: number;
  total_edges: number;
  by_domain: Record<string, number>;
  by_category: Record<string, number>;
  by_importance: Record<string, number>;
  cache_size: number;
  cache_max: number;
}

/**
 * Callback type — engine layer accepts this WITHOUT importing dashboard code.
 * Avoids engine→dashboard circular dependency.
 */
export type StepEmitter = (step: string, summary: string, data?: unknown) => void;

// === Logging (never use console.log in MCP — corrupts JSON-RPC stdio) ===

export function log(...args: unknown[]): void {
  console.error('[knowledge-graph]', ...args);
}
