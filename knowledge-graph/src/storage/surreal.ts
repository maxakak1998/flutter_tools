import { Surreal, RecordId, Table } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { StoredChunk, GraphEdge, QueryFilters, ListFilters, EMBEDDING_DIMENSIONS, log } from '../types.js';
import { IStorage } from './interface.js';

// ============================================================
// RecordId helper — SurrealDB returns RecordId objects, not strings
// ============================================================

function extractId(rid: unknown): string {
  if (rid instanceof RecordId) return String(rid.id);
  const s = String(rid);
  const idx = s.indexOf(':');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

// ============================================================
// Relation table name mapping (UPPERCASE → SurrealDB table name)
// REQUIRES is a reserved word in SurrealDB — use requires_rel
// ============================================================

const SURREAL_REL_TABLE: Record<string, string> = {
  RELATES_TO: 'relates_to',
  DEPENDS_ON: 'depends_on',
  CONTRADICTS: 'contradicts',
  SUPERSEDES: 'supersedes',
  TRIGGERS: 'triggers',
  REQUIRES: 'requires_rel',
  PRODUCES: 'produces',
  IS_PART_OF: 'is_part_of',
  CONSTRAINS: 'constrains',
  PRECEDES: 'precedes',
  TRANSITIONS_TO: 'transitions_to',
  GOVERNED_BY: 'governed_by',
};

// Reverse map: SurrealDB table name → lowercase relation type for GraphEdge output
const SURREAL_REL_REVERSE: Record<string, string> = {};
for (const [upper, surreal] of Object.entries(SURREAL_REL_TABLE)) {
  SURREAL_REL_REVERSE[surreal] = upper.toLowerCase();
}

const ALL_REL_TABLES = Object.values(SURREAL_REL_TABLE);

// ============================================================
// SurrealStorage — IStorage implementation using embedded SurrealDB
// ============================================================

export class SurrealStorage implements IStorage {
  private db: Surreal | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    mkdirSync(dirname(this.dbPath), { recursive: true });

    this.db = new Surreal({ engines: createNodeEngines() });
    await this.db.connect(`surrealkv://${this.dbPath}`);
    await this.db.use({ namespace: 'knowledge', database: 'graph' });

    await this.createSchema();
    log('SurrealStorage initialized at', this.dbPath);
  }

  private getDb(): Surreal {
    if (!this.db) throw new Error('SurrealDB not initialized');
    return this.db;
  }

  // ============================================================
  // Schema
  // ============================================================

  private async createSchema(): Promise<void> {
    const db = this.getDb();

    // Chunk table (SCHEMAFULL)
    await db.query(`DEFINE TABLE IF NOT EXISTS chunk SCHEMAFULL`);

    // Fields
    await db.query(`DEFINE FIELD IF NOT EXISTS sync_id ON chunk TYPE string DEFAULT ''`);
    await db.query(`DEFINE FIELD IF NOT EXISTS content ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS summary ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS embedding ON chunk TYPE array<float>`);
    await db.query(`DEFINE FIELD IF NOT EXISTS source ON chunk TYPE option<string>`);
    await db.query(`DEFINE FIELD IF NOT EXISTS category ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS domain ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS importance ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS layer ON chunk TYPE option<string> DEFAULT 'core-knowledge'`);
    await db.query(`DEFINE FIELD IF NOT EXISTS keywords ON chunk TYPE array`);
    await db.query(`DEFINE FIELD IF NOT EXISTS keywords.* ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS entities ON chunk TYPE array`);
    await db.query(`DEFINE FIELD IF NOT EXISTS entities.* ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS tags ON chunk TYPE array`);
    await db.query(`DEFINE FIELD IF NOT EXISTS tags.* ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS created_at ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS updated_at ON chunk TYPE string`);
    await db.query(`DEFINE FIELD IF NOT EXISTS version ON chunk TYPE int DEFAULT 1`);
    await db.query(`DEFINE FIELD IF NOT EXISTS confidence ON chunk TYPE float DEFAULT 0.5`);
    await db.query(`DEFINE FIELD IF NOT EXISTS validation_count ON chunk TYPE int DEFAULT 0`);
    await db.query(`DEFINE FIELD IF NOT EXISTS refutation_count ON chunk TYPE int DEFAULT 0`);
    await db.query(`DEFINE FIELD IF NOT EXISTS last_validated_at ON chunk TYPE string DEFAULT ''`);
    await db.query(`DEFINE FIELD IF NOT EXISTS lifecycle ON chunk TYPE string DEFAULT 'active'`);
    await db.query(`DEFINE FIELD IF NOT EXISTS access_count ON chunk TYPE int DEFAULT 0`);

    // HNSW vector index
    await db.query(
      `DEFINE INDEX IF NOT EXISTS idx_chunk_embedding ON chunk FIELDS embedding HNSW DIMENSION ${EMBEDDING_DIMENSIONS} DIST COSINE`
    );

    // Relation tables
    const relDefs: Array<{ table: string; extraFields: string[] }> = [
      { table: 'relates_to', extraFields: ['auto_created'] },
      { table: 'depends_on', extraFields: ['auto_created'] },
      { table: 'contradicts', extraFields: ['auto_created'] },
      { table: 'supersedes', extraFields: ['reason'] },
      { table: 'triggers', extraFields: ['description', 'auto_created'] },
      { table: 'requires_rel', extraFields: ['description', 'auto_created'] },
      { table: 'produces', extraFields: ['description', 'auto_created'] },
      { table: 'is_part_of', extraFields: ['description', 'auto_created'] },
      { table: 'constrains', extraFields: ['description', 'auto_created'] },
      { table: 'precedes', extraFields: ['description', 'auto_created'] },
      { table: 'transitions_to', extraFields: ['description', 'auto_created'] },
      { table: 'governed_by', extraFields: ['description', 'auto_created'] },
    ];

    for (const { table, extraFields } of relDefs) {
      await db.query(`DEFINE TABLE IF NOT EXISTS ${table} TYPE RELATION FROM chunk TO chunk SCHEMAFULL`);
      for (const field of extraFields) {
        await db.query(`DEFINE FIELD IF NOT EXISTS ${field} ON ${table} TYPE option<string>`);
      }
    }
  }

  // ============================================================
  // Chunk CRUD
  // ============================================================

  async createChunk(chunk: Omit<StoredChunk, 'created_at' | 'updated_at'> & Partial<Pick<StoredChunk, 'created_at' | 'updated_at'>>): Promise<string> {
    const db = this.getDb();
    const now = new Date().toISOString();
    const createdAt = chunk.created_at ?? now;
    const updatedAt = chunk.updated_at ?? now;

    await db.query(
      `CREATE type::thing('chunk', $id) CONTENT {
        sync_id: $sync_id,
        content: $content,
        summary: $summary,
        embedding: $embedding,
        source: $source,
        category: $category,
        domain: $domain,
        importance: $importance,
        layer: $layer,
        keywords: $keywords,
        entities: $entities,
        tags: $tags,
        created_at: $created_at,
        updated_at: $updated_at,
        version: $version,
        confidence: $confidence,
        validation_count: $validation_count,
        refutation_count: $refutation_count,
        last_validated_at: $last_validated_at,
        lifecycle: $lifecycle,
        access_count: $access_count
      }`,
      {
        id: chunk.id,
        sync_id: chunk.sync_id ?? '',
        content: chunk.content,
        summary: chunk.summary,
        embedding: chunk.embedding,
        source: chunk.source ?? null,
        category: chunk.category,
        domain: chunk.domain,
        importance: chunk.importance,
        layer: chunk.layer ?? 'core-knowledge',
        keywords: chunk.keywords,
        entities: chunk.entities,
        tags: chunk.tags,
        created_at: createdAt,
        updated_at: updatedAt,
        version: chunk.version,
        confidence: chunk.confidence ?? 0.5,
        validation_count: chunk.validation_count ?? 0,
        refutation_count: chunk.refutation_count ?? 0,
        last_validated_at: chunk.last_validated_at ?? '',
        lifecycle: chunk.lifecycle ?? 'active',
        access_count: chunk.access_count ?? 0,
      },
    );
    return chunk.id;
  }

  async getChunk(id: string): Promise<StoredChunk | null> {
    const db = this.getDb();
    const [rows] = await db.query<[unknown[]]>(
      `SELECT * FROM type::thing('chunk', $id)`,
      { id },
    );
    if (!rows || rows.length === 0) return null;
    return this.rowToChunk(rows[0] as Record<string, unknown>);
  }

  async updateChunk(id: string, updates: Partial<StoredChunk>): Promise<void> {
    const db = this.getDb();
    const setClauses: string[] = ['updated_at = $updated_at'];
    const params: Record<string, unknown> = {
      id,
      updated_at: new Date().toISOString(),
    };

    const fields: Array<[keyof StoredChunk, string]> = [
      ['sync_id', 'sync_id'],
      ['content', 'content'], ['summary', 'summary'], ['embedding', 'embedding'],
      ['source', 'source'], ['category', 'category'], ['domain', 'domain'],
      ['importance', 'importance'], ['layer', 'layer'], ['keywords', 'keywords'],
      ['entities', 'entities'], ['tags', 'tags'], ['version', 'version'],
      ['confidence', 'confidence'], ['validation_count', 'validation_count'],
      ['refutation_count', 'refutation_count'], ['last_validated_at', 'last_validated_at'],
      ['lifecycle', 'lifecycle'], ['access_count', 'access_count'],
    ];

    for (const [key, paramName] of fields) {
      if (updates[key] !== undefined) {
        setClauses.push(`${paramName} = $${paramName}`);
        params[paramName] = updates[key];
      }
    }

    await db.query(
      `UPDATE type::thing('chunk', $id) SET ${setClauses.join(', ')}`,
      params,
    );
  }

  async deleteChunk(id: string): Promise<void> {
    const db = this.getDb();

    // Delete edges from all relation tables
    for (const table of ALL_REL_TABLES) {
      await db.query(
        `DELETE ${table} WHERE in = type::thing('chunk', $id) OR out = type::thing('chunk', $id)`,
        { id },
      );
    }

    // Delete the chunk itself
    await db.query(`DELETE type::thing('chunk', $id)`, { id });
  }

  async listChunks(filters: ListFilters, limit = 50): Promise<StoredChunk[]> {
    const db = this.getDb();
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit };

    if (filters.domain) {
      conditions.push('(domain = $domain OR string::starts_with(domain, $domainPrefix))');
      params.domain = filters.domain;
      params.domainPrefix = filters.domain + '.';
    }
    if (filters.category) {
      conditions.push('category = $category');
      params.category = filters.category;
    }
    if (filters.importance) {
      conditions.push('importance = $importance');
      params.importance = filters.importance;
    }
    if (filters.layer) {
      conditions.push('layer = $layer');
      params.layer = filters.layer;
    }
    if (filters.source) {
      conditions.push('source = $source');
      params.source = filters.source;
    }
    if (filters.min_confidence !== undefined) {
      conditions.push('confidence >= $min_confidence');
      params.min_confidence = filters.min_confidence;
    }
    if (filters.lifecycle) {
      conditions.push('lifecycle = $lifecycle');
      params.lifecycle = filters.lifecycle;
    }
    if (filters.since) {
      conditions.push('updated_at >= $since');
      params.since = filters.since;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await db.query<[unknown[]]>(
      `SELECT * FROM chunk ${where} LIMIT $limit`,
      params,
    );

    if (!rows) return [];

    let chunks = rows.map((r) => this.rowToChunk(r as Record<string, unknown>));

    // Post-filter by tags
    if (filters.tags && filters.tags.length > 0) {
      const filterTags = filters.tags;
      chunks = chunks.filter((c) => filterTags.some((t) => c.tags.includes(t)));
    }

    return chunks;
  }

  // ============================================================
  // Relationships
  // ============================================================

  async createRelation(
    fromId: string,
    toId: string,
    relType: string,
    props?: Record<string, string>,
  ): Promise<void> {
    const db = this.getDb();
    const table = SURREAL_REL_TABLE[relType] ?? relType.toLowerCase();

    const ALLOWED_PROP_KEYS = new Set(['auto_created', 'reason', 'description']);
    const entries = props ? Object.entries(props).filter(([k]) => ALLOWED_PROP_KEYS.has(k)) : [];
    const params: Record<string, unknown> = { fromId, toId };

    const setClause = entries.length > 0
      ? ` SET ${entries.map(([k], i) => { params[`prop_${i}`] = entries[i][1]; return `${k} = $prop_${i}`; }).join(', ')}`
      : '';

    await db.query(
      `RELATE type::thing('chunk', $fromId) -> ${table} -> type::thing('chunk', $toId)${setClause}`,
      params,
    );
  }

  async deleteAutoRelations(chunkId: string): Promise<void> {
    const db = this.getDb();
    try {
      await db.query(
        `DELETE relates_to WHERE (in = type::thing('chunk', $id) OR out = type::thing('chunk', $id)) AND auto_created = 'true'`,
        { id: chunkId },
      );
    } catch (e) {
      log('deleteAutoRelations failed:', e);
    }
  }

  // ============================================================
  // Sync
  // ============================================================

  async findChunkBySyncId(syncId: string): Promise<StoredChunk | null> {
    const db = this.getDb();
    const [rows] = await db.query<[unknown[]]>(
      `SELECT * FROM chunk WHERE sync_id = $syncId LIMIT 1`,
      { syncId },
    );
    if (!rows || rows.length === 0) return null;
    return this.rowToChunk(rows[0] as Record<string, unknown>);
  }

  // ============================================================
  // Search
  // ============================================================

  async vectorSearch(
    embedding: number[],
    k: number,
    filters?: QueryFilters,
  ): Promise<Array<{ chunk: StoredChunk; distance: number }>> {
    const db = this.getDb();

    const [rows] = await db.query<[unknown[]]>(
      `SELECT *, vector::distance::knn() AS distance FROM chunk WHERE embedding <|${k}|> $vec ORDER BY distance`,
      { vec: embedding },
    );

    if (!rows) return [];

    let results = rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        chunk: this.rowToChunk(row),
        distance: Number(row.distance ?? 0),
      };
    });

    // Apply post-filters (same pattern as KuzuDB)
    if (filters?.domain) {
      results = results.filter((r) => r.chunk.domain === filters.domain || r.chunk.domain.startsWith(filters.domain + '.'));
    }
    if (filters?.category) {
      results = results.filter((r) => r.chunk.category === filters.category);
    }
    if (filters?.importance) {
      results = results.filter((r) => r.chunk.importance === filters.importance);
    }
    if (filters?.layer) {
      results = results.filter((r) => r.chunk.layer === filters.layer);
    }
    if (filters?.tags && filters.tags.length > 0) {
      results = results.filter((r) => filters.tags!.some((t) => r.chunk.tags.includes(t)));
    }
    if (filters?.min_confidence !== undefined) {
      results = results.filter((r) => r.chunk.confidence >= filters.min_confidence!);
    }
    if (filters?.lifecycle) {
      results = results.filter((r) => r.chunk.lifecycle === filters.lifecycle);
    }
    if (filters?.since) {
      results = results.filter((r) => r.chunk.updated_at >= filters.since!);
    }

    return results;
  }

  async vectorSearchUnfiltered(
    embedding: number[],
    k: number,
  ): Promise<Array<{ chunk: StoredChunk; distance: number }>> {
    const db = this.getDb();

    const [rows] = await db.query<[unknown[]]>(
      `SELECT *, vector::distance::knn() AS distance FROM chunk WHERE embedding <|${k}|> $vec ORDER BY distance`,
      { vec: embedding },
    );

    if (!rows) return [];

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        chunk: this.rowToChunk(row),
        distance: Number(row.distance ?? 0),
      };
    });
  }

  async getRelatedChunks(chunkId: string, depth = 2): Promise<StoredChunk[]> {
    const db = this.getDb();
    const seen = new Set<string>();
    const result: StoredChunk[] = [];

    // Collect neighbors at each depth level
    let currentIds = [chunkId];

    for (let d = 0; d < depth; d++) {
      const nextIds: string[] = [];

      for (const cid of currentIds) {
        for (const table of ALL_REL_TABLES) {
          // Outgoing
          const [outRows] = await db.query<[unknown[]]>(
            `SELECT *, out AS _dir_out FROM ${table} WHERE in = type::thing('chunk', $id) FETCH out`,
            { id: cid },
          );
          if (outRows) {
            for (const row of outRows) {
              const r = row as Record<string, unknown>;
              const outRecord = r.out as Record<string, unknown> | undefined;
              if (outRecord) {
                const rid = extractId(outRecord.id);
                if (!seen.has(rid) && rid !== chunkId) {
                  seen.add(rid);
                  result.push(this.rowToChunk(outRecord));
                  nextIds.push(rid);
                }
              }
            }
          }

          // Incoming
          const [inRows] = await db.query<[unknown[]]>(
            `SELECT *, in AS _dir_in FROM ${table} WHERE out = type::thing('chunk', $id) FETCH in`,
            { id: cid },
          );
          if (inRows) {
            for (const row of inRows) {
              const r = row as Record<string, unknown>;
              const inRecord = r.in as Record<string, unknown> | undefined;
              if (inRecord) {
                const rid = extractId(inRecord.id);
                if (!seen.has(rid) && rid !== chunkId) {
                  seen.add(rid);
                  result.push(this.rowToChunk(inRecord));
                  nextIds.push(rid);
                }
              }
            }
          }
        }
      }

      currentIds = nextIds;
      if (currentIds.length === 0) break;
    }

    return result;
  }

  async findChunksByDomain(domain: string): Promise<StoredChunk[]> {
    const db = this.getDb();
    const [rows] = await db.query<[unknown[]]>(
      `SELECT * FROM chunk WHERE domain = $domain`,
      { domain },
    );
    if (!rows) return [];
    return rows.map((r) => this.rowToChunk(r as Record<string, unknown>));
  }

  async findChunksByKeyword(keyword: string): Promise<StoredChunk[]> {
    const db = this.getDb();
    const lowerKeyword = keyword.toLowerCase();
    const [rows] = await db.query<[unknown[]]>(
      `SELECT * FROM chunk WHERE string::contains(string::lowercase(content), $kw) OR string::contains(string::lowercase(summary), $kw)`,
      { kw: lowerKeyword },
    );
    if (!rows) return [];
    return rows.map((r) => this.rowToChunk(r as Record<string, unknown>));
  }

  // ============================================================
  // Dashboard / Stats
  // ============================================================

  async getAllEdges(): Promise<GraphEdge[]> {
    const db = this.getDb();
    const edges: GraphEdge[] = [];

    for (const table of ALL_REL_TABLES) {
      const relName = SURREAL_REL_REVERSE[table] ?? table;
      const hasAuto = table !== 'supersedes';

      try {
        const [rows] = await db.query<[unknown[]]>(`SELECT in, out${hasAuto ? ', auto_created' : ''} FROM ${table}`);
        if (!rows) continue;
        for (const row of rows) {
          const r = row as Record<string, unknown>;
          edges.push({
            from: extractId(r.in),
            to: extractId(r.out),
            relation: relName,
            from_table: 'Chunk',
            to_table: 'Chunk',
            auto_created: hasAuto ? (r.auto_created as string) === 'true' : undefined,
          });
        }
      } catch {
        // Table may be empty or not yet have edges
      }
    }

    return edges;
  }

  async getStats(): Promise<{
    total_chunks: number;
    total_edges: number;
    by_domain: Record<string, number>;
    by_category: Record<string, number>;
    by_importance: Record<string, number>;
  }> {
    const db = this.getDb();

    // Total chunks
    const [countResult] = await db.query<[unknown[]]>(`SELECT count() AS cnt FROM chunk GROUP ALL`);
    const totalChunks = Number((countResult?.[0] as Record<string, unknown>)?.cnt ?? 0);

    // Total edges across all relation tables
    let totalEdges = 0;
    for (const table of ALL_REL_TABLES) {
      try {
        const [edgeCount] = await db.query<[unknown[]]>(`SELECT count() AS cnt FROM ${table} GROUP ALL`);
        totalEdges += Number((edgeCount?.[0] as Record<string, unknown>)?.cnt ?? 0);
      } catch {
        // Empty table
      }
    }

    // Group-by queries
    const [domainRows] = await db.query<[unknown[]]>(`SELECT domain, count() AS cnt FROM chunk GROUP BY domain`);
    const [categoryRows] = await db.query<[unknown[]]>(`SELECT category, count() AS cnt FROM chunk GROUP BY category`);
    const [importanceRows] = await db.query<[unknown[]]>(`SELECT importance, count() AS cnt FROM chunk GROUP BY importance`);

    const toRecord = (rows: unknown[] | undefined, keyCol: string): Record<string, number> => {
      const result: Record<string, number> = {};
      if (!rows) return result;
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        const key = (r[keyCol] as string) || 'unknown';
        result[key] = Number(r.cnt ?? 0);
      }
      return result;
    };

    return {
      total_chunks: totalChunks,
      total_edges: totalEdges,
      by_domain: toRecord(domainRows, 'domain'),
      by_category: toRecord(categoryRows, 'category'),
      by_importance: toRecord(importanceRows, 'importance'),
    };
  }

  // ============================================================
  // Access tracking
  // ============================================================

  async incrementAccessCount(ids: string[]): Promise<void> {
    const db = this.getDb();
    for (const id of ids) {
      await db.query(
        `UPDATE type::thing('chunk', $id) SET access_count += 1`,
        { id },
      );
    }
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    log('SurrealStorage closed');
  }

  // ============================================================
  // Row mapping helper
  // ============================================================

  private rowToChunk(row: Record<string, unknown>): StoredChunk {
    return {
      id: extractId(row.id),
      sync_id: (row.sync_id ?? '') as string,
      content: (row.content ?? '') as string,
      summary: (row.summary ?? '') as string,
      embedding: (row.embedding ?? []) as number[],
      source: (row.source ?? null) as string | null,
      category: (row.category ?? '') as string,
      domain: (row.domain ?? '') as string,
      importance: (row.importance ?? '') as string,
      layer: (row.layer ?? null) as string | null,
      keywords: (row.keywords ?? []) as string[],
      entities: (row.entities ?? []) as string[],
      tags: (row.tags ?? []) as string[],
      created_at: (row.created_at ?? '') as string,
      updated_at: (row.updated_at ?? '') as string,
      version: Number(row.version ?? 0),
      confidence: Number(row.confidence ?? 0.5),
      validation_count: Number(row.validation_count ?? 0),
      refutation_count: Number(row.refutation_count ?? 0),
      last_validated_at: (row.last_validated_at ?? '') as string,
      lifecycle: (row.lifecycle ?? 'active') as string,
      access_count: Number(row.access_count ?? 0),
    };
  }
}
