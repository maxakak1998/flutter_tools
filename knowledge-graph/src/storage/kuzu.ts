import { Database, Connection } from 'kuzu';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { StoredChunk, StoredCodeEntity, GraphEdge, QueryFilters, ListFilters, EMBEDDING_DIMENSIONS, RELATION_TABLE_MAP, log } from '../types.js';

interface SavedRelation {
  relType: string;
  direction: 'outgoing' | 'incoming';
  otherId: string;
  otherTable: string;
  props?: Record<string, string>;
}

export class KuzuStorage {
  private db: Database | null = null;
  private conn: Connection | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    // Create parent directory (KuzuDB manages the DB directory itself)
    const parentDir = dirname(this.dbPath);
    mkdirSync(parentDir, { recursive: true });
    this.db = new Database(this.dbPath);
    await this.db.init();
    this.conn = new Connection(this.db);
    await this.conn.init();

    // Load vector extension
    await this.run('INSTALL vector');
    await this.run('LOAD EXTENSION vector');

    await this.createSchema();
    await this.createIndices();
    log('KuzuStorage initialized at', this.dbPath);
  }

  private async run(cypher: string): Promise<void> {
    if (!this.conn) throw new Error('Connection not initialized');
    try {
      await this.conn.query(cypher);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Ignore "already exists" errors for idempotent schema creation
      if (msg.includes('already exists') || msg.includes('already has property')) return;
      throw e;
    }
  }

  private async query(cypher: string): Promise<Record<string, unknown>[]> {
    if (!this.conn) throw new Error('Connection not initialized');
    const result = await this.conn.query(cypher);
    return result.getAll();
  }

  private async queryParams(
    cypher: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    if (!this.conn) throw new Error('Connection not initialized');
    const stmt = await this.conn.prepare(cypher);
    if (!stmt.isSuccess()) {
      throw new Error(`Prepare failed: ${stmt.getErrorMessage()}`);
    }
    const result = await this.conn.execute(stmt, params);
    return result.getAll();
  }

  private async createSchema(): Promise<void> {
    // Node tables
    await this.run(`
      CREATE NODE TABLE Chunk (
        id STRING,
        content STRING,
        summary STRING,
        embedding DOUBLE[${EMBEDDING_DIMENSIONS}],
        source STRING,
        category STRING,
        domain STRING,
        importance STRING,
        layer STRING DEFAULT 'code-knowledge',
        keywords STRING[],
        entities STRING[],
        tags STRING[],
        created_at STRING,
        updated_at STRING,
        version INT64,
        PRIMARY KEY (id)
      )
    `);

    // Migration: add layer column to existing Chunk tables that lack it
    await this.run("ALTER TABLE Chunk ADD layer STRING DEFAULT 'code-knowledge'");

    await this.run(`
      CREATE NODE TABLE CodeEntity (
        id STRING,
        name STRING,
        entity_type STRING,
        file_path STRING,
        line_start INT64,
        line_end INT64,
        signature STRING,
        layer STRING,
        feature STRING,
        embedding DOUBLE[${EMBEDDING_DIMENSIONS}],
        updated_at STRING,
        PRIMARY KEY (id)
      )
    `);

    // Chunk → Chunk relationships
    await this.run('CREATE REL TABLE RELATES_TO (FROM Chunk TO Chunk, auto_created STRING)');
    await this.run('CREATE REL TABLE DEPENDS_ON (FROM Chunk TO Chunk)');

    // Migration: add auto_created column to existing RELATES_TO tables that lack it
    await this.run("ALTER TABLE RELATES_TO ADD auto_created STRING DEFAULT 'false'");
    await this.run('CREATE REL TABLE CONTRADICTS (FROM Chunk TO Chunk)');
    await this.run('CREATE REL TABLE SUPERSEDES (FROM Chunk TO Chunk, reason STRING)');

    // New semantic relationship types
    await this.run('CREATE REL TABLE TRIGGERS (FROM Chunk TO Chunk, description STRING, auto_created STRING)');
    await this.run('CREATE REL TABLE REQUIRES (FROM Chunk TO Chunk, description STRING, auto_created STRING)');
    await this.run('CREATE REL TABLE PRODUCES (FROM Chunk TO Chunk, description STRING, auto_created STRING)');
    await this.run('CREATE REL TABLE IS_PART_OF (FROM Chunk TO Chunk, description STRING, auto_created STRING)');
    await this.run('CREATE REL TABLE CONSTRAINS (FROM Chunk TO Chunk, description STRING, auto_created STRING)');
    await this.run('CREATE REL TABLE PRECEDES (FROM Chunk TO Chunk, description STRING, auto_created STRING)');

    // Chunk → CodeEntity relationships
    await this.run('CREATE REL TABLE IMPLEMENTED_BY (FROM Chunk TO CodeEntity, description STRING)');
    await this.run('CREATE REL TABLE TESTED_BY (FROM Chunk TO CodeEntity, description STRING)');
    await this.run('CREATE REL TABLE DEMONSTRATED_IN (FROM Chunk TO CodeEntity, description STRING)');

    // CodeEntity → CodeEntity relationships
    await this.run('CREATE REL TABLE DEFINED_IN (FROM CodeEntity TO CodeEntity)');
    await this.run('CREATE REL TABLE IMPORTS (FROM CodeEntity TO CodeEntity)');
    await this.run('CREATE REL TABLE TESTS (FROM CodeEntity TO CodeEntity)');
    await this.run('CREATE REL TABLE CODE_DEPENDS_ON (FROM CodeEntity TO CodeEntity, via STRING)');
    await this.run('CREATE REL TABLE IMPLEMENTS (FROM CodeEntity TO CodeEntity)');
    await this.run('CREATE REL TABLE INJECTS (FROM CodeEntity TO CodeEntity, registration STRING)');
  }

  private async createIndices(): Promise<void> {
    try {
      await this.run(
        "CALL CREATE_VECTOR_INDEX('Chunk', 'chunk_embedding_idx', 'embedding', metric := 'cosine')",
      );
    } catch {
      // Index may already exist
    }
  }

  // === Chunk CRUD ===

  async createChunk(chunk: Omit<StoredChunk, 'created_at' | 'updated_at'>): Promise<string> {
    const now = new Date().toISOString();
    await this.queryParams(
      `CREATE (c:Chunk {
        id: $id,
        content: $content,
        summary: $summary,
        embedding: cast($embedding, 'DOUBLE[${EMBEDDING_DIMENSIONS}]'),
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
        version: $version
      })`,
      {
        id: chunk.id,
        content: chunk.content,
        summary: chunk.summary,
        embedding: chunk.embedding,
        source: chunk.source ?? '',
        category: chunk.category,
        domain: chunk.domain,
        importance: chunk.importance,
        layer: chunk.layer ?? 'code-knowledge',
        keywords: chunk.keywords,
        entities: chunk.entities,
        tags: chunk.tags,
        created_at: now,
        updated_at: now,
        version: chunk.version,
      },
    );
    return chunk.id;
  }

  async getChunk(id: string): Promise<StoredChunk | null> {
    const rows = await this.queryParams(
      'MATCH (c:Chunk) WHERE c.id = $id RETURN c.*',
      { id },
    );
    if (rows.length === 0) return null;
    return this.rowToChunk(rows[0]);
  }

  async updateChunk(id: string, updates: Partial<StoredChunk>): Promise<void> {
    const hasEmbeddingUpdate = updates.embedding !== undefined;

    if (hasEmbeddingUpdate) {
      // KuzuDB does not allow SET on vector-indexed columns.
      // Workaround: save relations, delete node, re-insert, restore relations.
      const existing = await this.getChunk(id);
      if (!existing) throw new Error(`Chunk not found: ${id}`);

      const merged: StoredChunk = {
        ...existing,
        ...updates,
        id, // preserve original ID
        updated_at: new Date().toISOString(),
      };

      // Save all relationships before deleting the node
      const savedRelations = await this.saveChunkRelations(id);

      // Delete the old node (DETACH removes relationships too)
      await this.deleteChunk(id);

      // Re-insert with merged data
      await this.createChunk({
        id: merged.id,
        content: merged.content,
        summary: merged.summary,
        embedding: merged.embedding,
        source: merged.source,
        category: merged.category,
        domain: merged.domain,
        importance: merged.importance,
        layer: merged.layer,
        keywords: merged.keywords,
        entities: merged.entities,
        tags: merged.tags,
        version: merged.version,
      });

      // Restore saved relationships
      await this.restoreChunkRelations(id, savedRelations);
    } else {
      // No embedding update — safe to use SET directly
      const setClauses: string[] = ['c.updated_at = $updated_at'];
      const params: Record<string, unknown> = {
        id,
        updated_at: new Date().toISOString(),
      };

      if (updates.content !== undefined) {
        setClauses.push('c.content = $content');
        params.content = updates.content;
      }
      if (updates.summary !== undefined) {
        setClauses.push('c.summary = $summary');
        params.summary = updates.summary;
      }
      if (updates.source !== undefined) {
        setClauses.push('c.source = $source');
        params.source = updates.source;
      }
      if (updates.category !== undefined) {
        setClauses.push('c.category = $category');
        params.category = updates.category;
      }
      if (updates.domain !== undefined) {
        setClauses.push('c.domain = $domain');
        params.domain = updates.domain;
      }
      if (updates.importance !== undefined) {
        setClauses.push('c.importance = $importance');
        params.importance = updates.importance;
      }
      if (updates.layer !== undefined) {
        setClauses.push('c.layer = $layer');
        params.layer = updates.layer;
      }
      if (updates.keywords !== undefined) {
        setClauses.push('c.keywords = $keywords');
        params.keywords = updates.keywords;
      }
      if (updates.entities !== undefined) {
        setClauses.push('c.entities = $entities');
        params.entities = updates.entities;
      }
      if (updates.tags !== undefined) {
        setClauses.push('c.tags = $tags');
        params.tags = updates.tags;
      }
      if (updates.version !== undefined) {
        setClauses.push('c.version = $version');
        params.version = updates.version;
      }
      await this.queryParams(
        `MATCH (c:Chunk) WHERE c.id = $id SET ${setClauses.join(', ')}`,
        params,
      );
    }
  }

  async deleteChunk(id: string): Promise<void> {
    await this.queryParams(
      'MATCH (c:Chunk) WHERE c.id = $id DETACH DELETE c',
      { id },
    );
  }

  async listChunks(filters: ListFilters, limit = 50): Promise<StoredChunk[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit };

    if (filters.domain) {
      conditions.push('c.domain = $domain');
      params.domain = filters.domain;
    }
    if (filters.category) {
      conditions.push('c.category = $category');
      params.category = filters.category;
    }
    if (filters.importance) {
      conditions.push('c.importance = $importance');
      params.importance = filters.importance;
    }
    if (filters.source) {
      conditions.push('c.source = $source');
      params.source = filters.source;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.queryParams(
      `MATCH (c:Chunk) ${where} RETURN c.* LIMIT $limit`,
      params,
    );
    return rows.map((r) => this.rowToChunk(r));
  }

  // === CodeEntity CRUD ===

  async createCodeEntity(entity: Omit<StoredCodeEntity, 'updated_at'>): Promise<string> {
    const now = new Date().toISOString();
    await this.queryParams(
      `CREATE (e:CodeEntity {
        id: $id,
        name: $name,
        entity_type: $entity_type,
        file_path: $file_path,
        line_start: $line_start,
        line_end: $line_end,
        signature: $signature,
        layer: $layer,
        feature: $feature,
        embedding: cast($embedding, 'DOUBLE[${EMBEDDING_DIMENSIONS}]'),
        updated_at: $updated_at
      })`,
      {
        id: entity.id,
        name: entity.name,
        entity_type: entity.entity_type,
        file_path: entity.file_path,
        line_start: entity.line_start ?? 0,
        line_end: entity.line_end ?? 0,
        signature: entity.signature ?? '',
        layer: entity.layer ?? '',
        feature: entity.feature ?? '',
        embedding: entity.embedding,
        updated_at: now,
      },
    );
    return entity.id;
  }

  async getCodeEntity(id: string): Promise<StoredCodeEntity | null> {
    const rows = await this.queryParams(
      'MATCH (e:CodeEntity) WHERE e.id = $id RETURN e.*',
      { id },
    );
    if (rows.length === 0) return null;
    return this.rowToCodeEntity(rows[0]);
  }

  // === Relationships ===

  async createRelation(
    fromId: string,
    toId: string,
    relType: string,
    fromTable: string,
    toTable: string,
    props?: Record<string, string>,
  ): Promise<void> {
    const entries = props ? Object.entries(props) : [];
    const propsClause = entries.length > 0
      ? ` {${entries.map(([k, v]) => `${k}: '${v.replace(/'/g, "''")}'`).join(', ')}}`
      : '';

    await this.queryParams(
      `MATCH (a:${fromTable}), (b:${toTable})
       WHERE a.id = $fromId AND b.id = $toId
       CREATE (a)-[:${relType}${propsClause}]->(b)`,
      { fromId, toId },
    );
  }

  async deleteRelationsForNode(nodeId: string, table: string): Promise<void> {
    // Delete all outgoing and incoming relationships
    await this.queryParams(
      `MATCH (n:${table})-[r]->() WHERE n.id = $id DELETE r`,
      { id: nodeId },
    );
    await this.queryParams(
      `MATCH ()-[r]->(n:${table}) WHERE n.id = $id DELETE r`,
      { id: nodeId },
    );
  }

  /** Delete only auto-created RELATES_TO edges for a chunk (both directions). */
  async deleteAutoRelations(chunkId: string): Promise<void> {
    try {
      await this.queryParams(
        `MATCH (c:Chunk)-[r:RELATES_TO]->(t:Chunk)
         WHERE c.id = $id AND r.auto_created = 'true'
         DELETE r`,
        { id: chunkId },
      );
    } catch (e) {
      log('deleteAutoRelations outgoing failed:', e);
    }
    try {
      await this.queryParams(
        `MATCH (s:Chunk)-[r:RELATES_TO]->(c:Chunk)
         WHERE c.id = $id AND r.auto_created = 'true'
         DELETE r`,
        { id: chunkId },
      );
    } catch (e) {
      log('deleteAutoRelations incoming failed:', e);
    }
  }

  /**
   * Save all Chunk relations before a DETACH DELETE.
   * Returns a list of saved edges that can be restored after re-creating the node.
   */
  private async saveChunkRelations(chunkId: string): Promise<SavedRelation[]> {
    const saved: SavedRelation[] = [];

    // Chunk → Chunk (outgoing)
    const chunkRelTypes = [
      { type: 'RELATES_TO', propCols: ['r.auto_created AS auto_created'] },
      { type: 'DEPENDS_ON', propCols: [] },
      { type: 'CONTRADICTS', propCols: [] },
      { type: 'SUPERSEDES', propCols: ['r.reason AS reason'] },
      { type: 'TRIGGERS', propCols: ['r.description AS description', 'r.auto_created AS auto_created'] },
      { type: 'REQUIRES', propCols: ['r.description AS description', 'r.auto_created AS auto_created'] },
      { type: 'PRODUCES', propCols: ['r.description AS description', 'r.auto_created AS auto_created'] },
      { type: 'IS_PART_OF', propCols: ['r.description AS description', 'r.auto_created AS auto_created'] },
      { type: 'CONSTRAINS', propCols: ['r.description AS description', 'r.auto_created AS auto_created'] },
      { type: 'PRECEDES', propCols: ['r.description AS description', 'r.auto_created AS auto_created'] },
    ];

    for (const { type, propCols } of chunkRelTypes) {
      const returnCols = ['t.id AS target_id', ...propCols].join(', ');
      try {
        const rows = await this.queryParams(
          `MATCH (c:Chunk)-[r:${type}]->(t:Chunk) WHERE c.id = $id RETURN ${returnCols}`,
          { id: chunkId },
        );
        for (const row of rows) {
          const props: Record<string, string> = {};
          if (row['auto_created']) {
            props['auto_created'] = row['auto_created'] as string;
          }
          if (row['reason']) {
            props['reason'] = row['reason'] as string;
          }
          if (row['description']) {
            props['description'] = row['description'] as string;
          }
          saved.push({
            relType: type,
            direction: 'outgoing',
            otherId: row['target_id'] as string,
            otherTable: 'Chunk',
            props: Object.keys(props).length > 0 ? props : undefined,
          });
        }
      } catch {
        // Relation type may not exist yet
      }
    }

    // Chunk → Chunk (incoming)
    for (const { type, propCols } of chunkRelTypes) {
      const returnCols = ['s.id AS source_id', ...propCols].join(', ');
      try {
        const rows = await this.queryParams(
          `MATCH (s:Chunk)-[r:${type}]->(c:Chunk) WHERE c.id = $id RETURN ${returnCols}`,
          { id: chunkId },
        );
        for (const row of rows) {
          const props: Record<string, string> = {};
          if (row['auto_created']) {
            props['auto_created'] = row['auto_created'] as string;
          }
          if (row['reason']) {
            props['reason'] = row['reason'] as string;
          }
          if (row['description']) {
            props['description'] = row['description'] as string;
          }
          saved.push({
            relType: type,
            direction: 'incoming',
            otherId: row['source_id'] as string,
            otherTable: 'Chunk',
            props: Object.keys(props).length > 0 ? props : undefined,
          });
        }
      } catch {
        // Relation type may not exist yet
      }
    }

    // Chunk → CodeEntity (outgoing only)
    const codeRelTypes = ['IMPLEMENTED_BY', 'TESTED_BY', 'DEMONSTRATED_IN'];
    for (const type of codeRelTypes) {
      try {
        const rows = await this.queryParams(
          `MATCH (c:Chunk)-[r:${type}]->(e:CodeEntity) WHERE c.id = $id
           RETURN e.id AS target_id, r.description AS description`,
          { id: chunkId },
        );
        for (const row of rows) {
          const props: Record<string, string> = {};
          if (row['description']) {
            props['description'] = row['description'] as string;
          }
          saved.push({
            relType: type,
            direction: 'outgoing',
            otherId: row['target_id'] as string,
            otherTable: 'CodeEntity',
            props: Object.keys(props).length > 0 ? props : undefined,
          });
        }
      } catch {
        // Relation type may not exist yet
      }
    }

    return saved;
  }

  /** Restore previously saved relations after re-creating a chunk node. */
  private async restoreChunkRelations(chunkId: string, relations: SavedRelation[]): Promise<void> {
    for (const rel of relations) {
      try {
        if (rel.direction === 'outgoing') {
          await this.createRelation(chunkId, rel.otherId, rel.relType, 'Chunk', rel.otherTable, rel.props);
        } else {
          await this.createRelation(rel.otherId, chunkId, rel.relType, rel.otherTable, 'Chunk', rel.props);
        }
      } catch (e) {
        log('Restore relation failed:', rel.relType, rel.direction, rel.otherId, ':', e);
      }
    }
  }

  // === Search ===

  async vectorSearch(
    embedding: number[],
    k: number,
    filters?: QueryFilters,
  ): Promise<Array<{ chunk: StoredChunk; distance: number }>> {
    // Vector search returns node and distance
    // Note: QUERY_VECTOR_INDEX doesn't support cast() in parameterized form,
    // so we pass the embedding directly as a $emb parameter.
    const rows = await this.queryParams(
      `CALL QUERY_VECTOR_INDEX('Chunk', 'chunk_embedding_idx', $emb, $k)
       RETURN node.id AS id, node.content AS content, node.summary AS summary,
              node.source AS source, node.category AS category,
              node.domain AS domain, node.importance AS importance, node.layer AS layer,
              node.keywords AS keywords,
              node.entities AS entities, node.tags AS tags, node.created_at AS created_at,
              node.updated_at AS updated_at, node.version AS version,
              distance`,
      { emb: embedding, k },
    );

    let results = rows.map((r) => ({
      chunk: this.flatRowToChunk(r),
      distance: r.distance as number,
    }));

    // Apply post-filters
    if (filters?.domain) {
      results = results.filter((r) => r.chunk.domain === filters.domain);
    }
    if (filters?.category) {
      results = results.filter((r) => r.chunk.category === filters.category);
    }
    if (filters?.importance) {
      results = results.filter((r) => r.chunk.importance === filters.importance);
    }
    if (filters?.tags && filters.tags.length > 0) {
      results = results.filter((r) =>
        filters.tags!.some((t) => r.chunk.tags.includes(t)),
      );
    }
    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /** Raw vector search with no metadata filters — used for dedup checks. */
  async vectorSearchUnfiltered(
    embedding: number[],
    k: number,
  ): Promise<Array<{ chunk: StoredChunk; distance: number }>> {
    const rows = await this.queryParams(
      `CALL QUERY_VECTOR_INDEX('Chunk', 'chunk_embedding_idx', $emb, $k)
       RETURN node.id AS id, node.content AS content, node.summary AS summary,
              node.source AS source, node.category AS category,
              node.domain AS domain, node.importance AS importance, node.layer AS layer,
              node.keywords AS keywords,
              node.entities AS entities, node.tags AS tags, node.created_at AS created_at,
              node.updated_at AS updated_at, node.version AS version,
              distance`,
      { emb: embedding, k },
    );

    return rows.map((r) => ({
      chunk: this.flatRowToChunk(r),
      distance: r.distance as number,
    }));
  }

  async getRelatedChunks(chunkId: string, depth = 2): Promise<StoredChunk[]> {
    const rows = await this.queryParams(
      `MATCH (c:Chunk {id: $id})-[r:RELATES_TO|DEPENDS_ON|CONTRADICTS|SUPERSEDES|TRIGGERS|REQUIRES|PRODUCES|IS_PART_OF|CONSTRAINS|PRECEDES*1..${depth}]-(related:Chunk)
       RETURN DISTINCT related.*`,
      { id: chunkId },
    );
    return rows.map((r) => this.rowToChunk(r));
  }

  async getCodeLinksForChunk(
    chunkId: string,
  ): Promise<Array<{ entity: StoredCodeEntity; relation: string; description: string | null }>> {
    const relTypes = ['IMPLEMENTED_BY', 'TESTED_BY', 'DEMONSTRATED_IN'];
    const results: Array<{ entity: StoredCodeEntity; relation: string; description: string | null }> = [];

    for (const relType of relTypes) {
      const rows = await this.queryParams(
        `MATCH (c:Chunk)-[r:${relType}]->(e:CodeEntity)
         WHERE c.id = $id
         RETURN e.*, r.description AS rel_description`,
        { id: chunkId },
      );
      for (const row of rows) {
        results.push({
          entity: this.rowToCodeEntity(row),
          relation: relType.toLowerCase(),
          description: (row['rel_description'] as string) || null,
        });
      }
    }

    return results;
  }

  async findChunksByDomain(domain: string): Promise<StoredChunk[]> {
    const rows = await this.queryParams(
      'MATCH (c:Chunk) WHERE c.domain = $domain RETURN c.*',
      { domain },
    );
    return rows.map((r) => this.rowToChunk(r));
  }

  async findChunksByKeyword(keyword: string): Promise<StoredChunk[]> {
    const lowerKeyword = keyword.toLowerCase();
    const rows = await this.queryParams(
      `MATCH (c:Chunk)
       WHERE c.content CONTAINS $keyword OR c.summary CONTAINS $keyword
       RETURN c.*`,
      { keyword: lowerKeyword },
    );
    return rows.map((r) => this.rowToChunk(r));
  }

  // === Dashboard / Stats ===

  async getAllEdges(): Promise<GraphEdge[]> {
    const edges: GraphEdge[] = [];

    // Chunk → Chunk relationships
    const chunkRelTypes = [
      { type: 'RELATES_TO', hasAutoProp: true },
      { type: 'DEPENDS_ON', hasAutoProp: false },
      { type: 'CONTRADICTS', hasAutoProp: false },
      { type: 'SUPERSEDES', hasAutoProp: false },
      { type: 'TRIGGERS', hasAutoProp: true },
      { type: 'REQUIRES', hasAutoProp: true },
      { type: 'PRODUCES', hasAutoProp: true },
      { type: 'IS_PART_OF', hasAutoProp: true },
      { type: 'CONSTRAINS', hasAutoProp: true },
      { type: 'PRECEDES', hasAutoProp: true },
    ];

    for (const { type, hasAutoProp } of chunkRelTypes) {
      try {
        const returnCols = hasAutoProp
          ? 'a.id AS from_id, b.id AS to_id, r.auto_created AS auto_created'
          : 'a.id AS from_id, b.id AS to_id';
        const rows = await this.query(
          `MATCH (a:Chunk)-[r:${type}]->(b:Chunk) RETURN ${returnCols}`
        );
        for (const row of rows) {
          edges.push({
            from: row['from_id'] as string,
            to: row['to_id'] as string,
            relation: type.toLowerCase(),
            from_table: 'Chunk',
            to_table: 'Chunk',
            auto_created: hasAutoProp ? (row['auto_created'] as string) === 'true' : undefined,
          });
        }
      } catch {
        // Table may not have edges yet
      }
    }

    // Chunk → CodeEntity relationships
    const codeRelTypes = ['IMPLEMENTED_BY', 'TESTED_BY', 'DEMONSTRATED_IN'];
    for (const type of codeRelTypes) {
      try {
        const rows = await this.query(
          `MATCH (a:Chunk)-[r:${type}]->(b:CodeEntity) RETURN a.id AS from_id, b.id AS to_id`
        );
        for (const row of rows) {
          edges.push({
            from: row['from_id'] as string,
            to: row['to_id'] as string,
            relation: type.toLowerCase(),
            from_table: 'Chunk',
            to_table: 'CodeEntity',
          });
        }
      } catch {
        // Table may not have edges yet
      }
    }

    return edges;
  }

  async getStats(): Promise<{ total_chunks: number; total_code_entities: number; total_edges: number; by_domain: Record<string, number>; by_category: Record<string, number>; by_importance: Record<string, number> }> {
    const [chunkCount] = await this.query('MATCH (c:Chunk) RETURN count(c) AS cnt');
    const [codeCount] = await this.query('MATCH (e:CodeEntity) RETURN count(e) AS cnt');

    // Count all edges across all relationship types
    let totalEdges = 0;
    const relTypes = ['RELATES_TO', 'DEPENDS_ON', 'CONTRADICTS', 'SUPERSEDES', 'TRIGGERS', 'REQUIRES', 'PRODUCES', 'IS_PART_OF', 'CONSTRAINS', 'PRECEDES', 'IMPLEMENTED_BY', 'TESTED_BY', 'DEMONSTRATED_IN'];
    for (const type of relTypes) {
      try {
        const fromTable = ['IMPLEMENTED_BY', 'TESTED_BY', 'DEMONSTRATED_IN'].includes(type) ? 'Chunk' : 'Chunk';
        const toTable = ['IMPLEMENTED_BY', 'TESTED_BY', 'DEMONSTRATED_IN'].includes(type) ? 'CodeEntity' : 'Chunk';
        const [row] = await this.query(`MATCH (a:${fromTable})-[r:${type}]->(b:${toTable}) RETURN count(r) AS cnt`);
        totalEdges += Number(row?.['cnt'] ?? 0);
      } catch {
        // Table may be empty
      }
    }

    // Group-by queries
    const domainRows = await this.query('MATCH (c:Chunk) RETURN c.domain AS domain, count(c) AS cnt');
    const categoryRows = await this.query('MATCH (c:Chunk) RETURN c.category AS category, count(c) AS cnt');
    const importanceRows = await this.query('MATCH (c:Chunk) RETURN c.importance AS importance, count(c) AS cnt');

    const toRecord = (rows: Record<string, unknown>[], keyCol: string): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const row of rows) {
        const key = (row[keyCol] as string) || 'unknown';
        result[key] = Number(row['cnt'] ?? 0);
      }
      return result;
    };

    return {
      total_chunks: Number(chunkCount?.['cnt'] ?? 0),
      total_code_entities: Number(codeCount?.['cnt'] ?? 0),
      total_edges: totalEdges,
      by_domain: toRecord(domainRows, 'domain'),
      by_category: toRecord(categoryRows, 'category'),
      by_importance: toRecord(importanceRows, 'importance'),
    };
  }

  async listCodeEntities(): Promise<StoredCodeEntity[]> {
    const rows = await this.query('MATCH (e:CodeEntity) RETURN e.*');
    return rows.map((r) => this.rowToCodeEntity(r));
  }

  // === Utility ===

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    log('KuzuStorage closed');
  }

  // === Row mapping helpers ===

  /** Map a row from `RETURN c.*` (c.id, c.content, ...) to StoredChunk */
  private rowToChunk(row: Record<string, unknown>): StoredChunk {
    return {
      id: (row['c.id'] ?? row['related.id'] ?? '') as string,
      content: (row['c.content'] ?? row['related.content'] ?? '') as string,
      summary: (row['c.summary'] ?? row['related.summary'] ?? '') as string,
      embedding: (row['c.embedding'] ?? row['related.embedding'] ?? []) as number[],
      source: (row['c.source'] ?? row['related.source'] ?? null) as string | null,
      category: (row['c.category'] ?? row['related.category'] ?? '') as string,
      domain: (row['c.domain'] ?? row['related.domain'] ?? '') as string,
      importance: (row['c.importance'] ?? row['related.importance'] ?? '') as string,
      layer: (row['c.layer'] ?? row['related.layer'] ?? null) as string | null,
      keywords: (row['c.keywords'] ?? row['related.keywords'] ?? []) as string[],
      entities: (row['c.entities'] ?? row['related.entities'] ?? []) as string[],
      tags: (row['c.tags'] ?? row['related.tags'] ?? []) as string[],
      created_at: (row['c.created_at'] ?? row['related.created_at'] ?? '') as string,
      updated_at: (row['c.updated_at'] ?? row['related.updated_at'] ?? '') as string,
      version: Number(row['c.version'] ?? row['related.version'] ?? 0),
    };
  }

  /** Map a row from flat column aliases (id, content, ...) to StoredChunk — for vector search */
  private flatRowToChunk(row: Record<string, unknown>): StoredChunk {
    return {
      id: (row['id'] ?? '') as string,
      content: (row['content'] ?? '') as string,
      summary: (row['summary'] ?? '') as string,
      embedding: (row['embedding'] ?? []) as number[],
      source: (row['source'] ?? null) as string | null,
      category: (row['category'] ?? '') as string,
      domain: (row['domain'] ?? '') as string,
      importance: (row['importance'] ?? '') as string,
      layer: (row['layer'] ?? null) as string | null,
      keywords: (row['keywords'] ?? []) as string[],
      entities: (row['entities'] ?? []) as string[],
      tags: (row['tags'] ?? []) as string[],
      created_at: (row['created_at'] ?? '') as string,
      updated_at: (row['updated_at'] ?? '') as string,
      version: Number(row['version'] ?? 0),
    };
  }

  /** Map a row from `RETURN e.*` to StoredCodeEntity */
  private rowToCodeEntity(row: Record<string, unknown>): StoredCodeEntity {
    return {
      id: (row['e.id'] ?? '') as string,
      name: (row['e.name'] ?? '') as string,
      entity_type: (row['e.entity_type'] ?? '') as string,
      file_path: (row['e.file_path'] ?? '') as string,
      line_start: row['e.line_start'] != null ? Number(row['e.line_start']) : null,
      line_end: row['e.line_end'] != null ? Number(row['e.line_end']) : null,
      signature: (row['e.signature'] as string) || null,
      layer: (row['e.layer'] as string) || null,
      feature: (row['e.feature'] as string) || null,
      embedding: (row['e.embedding'] ?? []) as number[],
      updated_at: (row['e.updated_at'] ?? '') as string,
    };
  }
}
