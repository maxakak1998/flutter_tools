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
  code_refs?: CodeRef[];
}

export type ChunkLayer = 'business-domain' | 'code-knowledge' | string;

export type ChunkCategory =
  | 'rule'
  | 'pattern'
  | 'example'
  | 'reference'
  | 'learning'
  | 'workflow'
  | 'concept';

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
  | 'precedes';

export type CodeRelation =
  | 'implemented_by'
  | 'tested_by'
  | 'demonstrated_in'
  | 'depends_on'
  | 'implements'
  | 'injects';

export type EntityType =
  | 'class'
  | 'method'
  | 'function'
  | 'interface'
  | 'file'
  | 'mixin'
  | 'enum'
  | 'widget'
  | 'cubit'
  | 'repository'
  | 'use-case'
  | 'test-file'
  | 'factory'
  | 'extension'
  | 'constant'
  | 'type-alias'
  | 'screen'
  | 'route'
  | 'inject-module';

export interface SuggestedRelation {
  concept: string;
  relation: 'relates_to' | 'depends_on' | 'contradicts' | 'triggers' | 'requires' | 'produces' | 'is_part_of' | 'constrains' | 'precedes';
}

export interface CodeRef {
  name: string;
  entity_type: EntityType;
  file_path: string;
  line_start?: number;
  layer?: 'presentation' | 'domain' | 'data' | 'core' | 'test';
  feature?: string;
  signature?: string;
  relation: CodeRelation;
  via?: string;
  description?: string;
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
}

export interface StoredCodeEntity {
  id: string;
  name: string;
  entity_type: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  signature: string | null;
  layer: string | null;
  feature: string | null;
  embedding: number[];
  updated_at: string;
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
  };
  score: number;
  code_links: CodeLink[];
}

export interface CodeLink {
  name: string;
  type: string;
  path: string;
  relation: string;
  description?: string;
}

export interface StoreResult {
  id: string;
  auto_links: AutoLink[];
  warnings: string[];
  duplicate_of?: string;
  similarity?: number;
  existing_summary?: string;
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
  superseded_id: string | null;
}

// === Filter types ===

export interface QueryFilters {
  domain?: string;
  category?: string;
  importance?: string;
  tags?: string[];
  limit?: number;
}

export interface ListFilters {
  domain?: string;
  category?: string;
  importance?: string;
  tags?: string[];
  source?: string;
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
};

export const CODE_RELATION_TABLE_MAP: Record<string, string> = {
  implemented_by: 'IMPLEMENTED_BY',
  tested_by: 'TESTED_BY',
  demonstrated_in: 'DEMONSTRATED_IN',
};

export const CODE_CODE_RELATION_TABLE_MAP: Record<string, string> = {
  defined_in: 'DEFINED_IN',
  imports: 'IMPORTS',
  tests: 'TESTS',
  code_depends_on: 'CODE_DEPENDS_ON',
  implements: 'IMPLEMENTS',
  injects: 'INJECTS',
};

// === Dashboard types ===

/** Granular event emitted for each pipeline step — drives dashboard animations. */
export interface DashboardEvent {
  id: string;           // UUID for the REQUEST (all steps of one request share this)
  timestamp: string;    // ISO 8601
  tool: string;         // 'store' | 'query' | 'evolve' | 'link' | ...
  step: string;         // 'start' | 'embedding' | 'vector_search' | 'keyword_boost' | 'graph_expand' | 'score_merge' | 'mmr_rerank' | 'complete' | 'error'
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
  total_code_entities: number;
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
