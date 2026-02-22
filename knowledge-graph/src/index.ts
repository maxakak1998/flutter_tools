import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { KuzuStorage } from './storage/kuzu.js';
import { Embedder } from './engine/embedder.js';
import { Retriever } from './engine/retriever.js';
import { Linker } from './engine/linker.js';
import { handleQuery } from './tools/query.js';
import { handleStore } from './tools/store.js';
import { handleIngest } from './tools/ingest.js';
import { handleLink } from './tools/link.js';
import { handleLinkCode } from './tools/link-code.js';
import { handleList } from './tools/list.js';
import { handleDelete } from './tools/delete.js';
import { handleEvolve } from './tools/evolve.js';
import { log } from './types.js';
import { randomUUID } from 'crypto';
import { EventBus } from './dashboard/events.js';
import { DashboardServer } from './dashboard/server.js';
import { KnowledgeConfig, DEFAULT_CONFIG } from './config.js';

export type { KnowledgeConfig } from './config.js';

export async function main(config: KnowledgeConfig = DEFAULT_CONFIG) {
  const { db, ollama, dashboard: dashCfg, search, limits, cache, dedup } = config;

  // Initialize core components
  const storage = new KuzuStorage(db.path);
  const embedder = new Embedder(ollama.url, ollama.model, cache.embeddingCacheSize);
  const retriever = new Retriever(storage, embedder, search.defaultLimit);
  const linker = new Linker(storage, embedder, search.similarityThreshold, search.autoLinkTopK);

  // Dashboard
  const eventBus = new EventBus();
  const dashboard = new DashboardServer(storage, embedder, retriever, eventBus);

  // Create MCP server
  const server = new McpServer({
    name: 'knowledge-graph',
    version: '1.0.0',
  });

  // ============================================================
  // Tool: knowledge_query
  // ============================================================
  server.tool(
    'knowledge_query',
    'Search knowledge base using semantic + graph retrieval. Returns relevant chunks with metadata and code links.',
    {
      query: z.string().describe('Natural language search query'),
      filters: z.object({
        domain: z.string().optional().describe('Filter by domain (e.g., "dependency-injection")'),
        category: z.enum(['rule', 'pattern', 'example', 'reference', 'learning', 'workflow', 'concept']).optional().describe('Filter by category'),
        importance: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter by importance'),
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        limit: z.number().optional().describe('Max results to return (default 10)'),
      }).optional().describe('Optional filters to narrow results'),
    },
    async ({ query, filters }) => {
      const requestId = randomUUID();
      const onStep = eventBus.makeStepEmitter(requestId, 'query');
      onStep('start', `Query: "${query.slice(0, 60)}"`);
      const t0 = performance.now();
      try {
        const result = await handleQuery(retriever, query, filters, onStep);
        onStep('complete', `${result.total} results`, { duration_ms: Math.round(performance.now() - t0), result_count: result.total });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        onStep('error', String(e));
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool: knowledge_store
  // ============================================================
  server.tool(
    'knowledge_store',
    'Store a new knowledge chunk with Claude-generated metadata. Embeds content, stores in graph DB, and auto-links to related chunks.',
    {
      content: z.string().max(limits.maxContentLength).describe('The knowledge content to store'),
      metadata: z.object({
        summary: z.string().min(1).max(limits.maxSummaryLength).describe('1-sentence description of this knowledge'),
        keywords: z.array(z.string().min(2)).min(1).max(15).describe('5-15 key terms/concepts'),
        domain: z.string().max(50).describe('Topic area (e.g., "dependency-injection", "state-management")'),
        category: z.enum(['rule', 'pattern', 'example', 'reference', 'learning', 'workflow', 'concept']),
        importance: z.enum(['critical', 'high', 'medium', 'low']),
        layer: z.string().optional().describe('Knowledge layer: "business-domain" for pure business rules/concepts, "code-knowledge" for implementation patterns. Extensible.'),
        entities: z.array(z.string().min(2)).optional().describe('Named things: class names, function names, tools'),
        suggested_relations: z.array(z.object({
          concept: z.string(),
          relation: z.enum(['relates_to', 'depends_on', 'contradicts', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes']),
        })).optional().describe('Suggested links to other knowledge'),
        tags: z.array(z.string()).optional().describe('Free-form tags'),
        source: z.string().optional().describe('Where this knowledge came from'),
        code_refs: z.array(z.object({
          name: z.string(),
          entity_type: z.enum([
            'class', 'method', 'function', 'interface', 'file', 'mixin', 'enum',
            'widget', 'cubit', 'repository', 'use-case', 'test-file', 'factory',
            'extension', 'constant', 'type-alias', 'screen', 'route', 'inject-module',
          ]),
          file_path: z.string().min(1),
          line_start: z.number().optional(),
          layer: z.enum(['presentation', 'domain', 'data', 'core', 'test']).optional(),
          feature: z.string().optional(),
          signature: z.string().optional(),
          relation: z.enum(['implemented_by', 'tested_by', 'demonstrated_in', 'depends_on', 'implements', 'injects']),
          via: z.string().optional(),
          description: z.string().optional(),
        })).optional().describe('Links to code implementations'),
      }),
    },
    async ({ content, metadata }) => {
      const requestId = randomUUID();
      const onStep = eventBus.makeStepEmitter(requestId, 'store');
      onStep('start', `Store: "${metadata.summary.slice(0, 50)}"`);
      const t0 = performance.now();
      try {
        const result = await handleStore(storage, embedder, linker, content, metadata, onStep, dedup.similarityThreshold);
        onStep('complete', `Stored ${result.id}`, { duration_ms: Math.round(performance.now() - t0), id: result.id, auto_links: result.auto_links.length });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        onStep('error', String(e));
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool: knowledge_link
  // ============================================================
  server.tool(
    'knowledge_link',
    'Create a relationship between two knowledge chunks.',
    {
      source_id: z.string().describe('Source chunk ID'),
      target_id: z.string().describe('Target chunk ID'),
      relation: z.enum(['relates_to', 'depends_on', 'contradicts', 'supersedes', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes']).describe('Relationship type'),
    },
    async ({ source_id, target_id, relation }) => {
      const requestId = randomUUID();
      const onStep = eventBus.makeStepEmitter(requestId, 'link');
      onStep('start', `Link: ${relation}`);
      const t0 = performance.now();
      try {
        const result = await handleLink(storage, source_id, target_id, relation);
        onStep('complete', `Linked ${source_id.slice(0, 8)} → ${target_id.slice(0, 8)}`, { duration_ms: Math.round(performance.now() - t0) });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        onStep('error', String(e));
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool: knowledge_link_code
  // ============================================================
  server.tool(
    'knowledge_link_code',
    'Link a knowledge chunk to code entities (files, classes, methods, etc.).',
    {
      chunk_id: z.string().describe('Knowledge chunk to link from'),
      code_entities: z.array(z.object({
        name: z.string(),
        entity_type: z.enum([
          'class', 'method', 'function', 'interface', 'file', 'mixin', 'enum',
          'widget', 'cubit', 'repository', 'use-case', 'test-file', 'factory',
          'extension', 'constant', 'type-alias', 'screen', 'route', 'inject-module',
        ]),
        file_path: z.string().min(1),
        line_start: z.number().optional(),
        layer: z.enum(['presentation', 'domain', 'data', 'core', 'test']).optional(),
        feature: z.string().optional(),
        signature: z.string().optional(),
        relation: z.enum(['implemented_by', 'tested_by', 'demonstrated_in', 'depends_on', 'implements', 'injects']),
        via: z.string().optional(),
        description: z.string().optional(),
      })).describe('Code entities to link to'),
    },
    async ({ chunk_id, code_entities }) => {
      try {
        const result = await handleLinkCode(storage, embedder, chunk_id, code_entities);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool: knowledge_ingest
  // ============================================================
  server.tool(
    'knowledge_ingest',
    'Read a file and return its content for Claude to analyze and store as knowledge chunks.',
    {
      path: z.string().describe('Absolute file path to read'),
    },
    async ({ path: filePath }) => {
      try {
        const result = await handleIngest(filePath);
        let message = `File: ${result.path}\nSize: ${result.size} characters\n\n${result.content}`;
        if (result.size > 50000) {
          message += '\n\n⚠️ Large file. Please chunk this into multiple knowledge_store() calls.';
        }
        return {
          content: [{ type: 'text' as const, text: message }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool: knowledge_list
  // ============================================================
  server.tool(
    'knowledge_list',
    'Browse knowledge chunks by filters. Returns summary view (not full content).',
    {
      filters: z.object({
        domain: z.string().optional(),
        category: z.enum(['rule', 'pattern', 'example', 'reference', 'learning', 'workflow', 'concept']).optional(),
        importance: z.enum(['critical', 'high', 'medium', 'low']).optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
      }).optional().describe('Optional filters'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ filters, limit }) => {
      try {
        const result = await handleList(storage, filters ?? {}, limit ?? 50);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool: knowledge_delete
  // ============================================================
  server.tool(
    'knowledge_delete',
    'Delete a knowledge chunk and all its relationships.',
    {
      id: z.string().describe('Chunk ID to delete'),
    },
    async ({ id }) => {
      try {
        const result = await handleDelete(storage, id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool: knowledge_evolve
  // ============================================================
  server.tool(
    'knowledge_evolve',
    'Update a knowledge chunk: re-embed, version bump, archive old version, re-link.',
    {
      id: z.string().describe('Chunk ID to evolve'),
      new_content: z.string().max(limits.maxContentLength).describe('Updated content'),
      new_metadata: z.object({
        summary: z.string().min(1).max(limits.maxSummaryLength).optional(),
        keywords: z.array(z.string().min(2)).optional(),
        domain: z.string().optional(),
        category: z.enum(['rule', 'pattern', 'example', 'reference', 'learning', 'workflow', 'concept']).optional(),
        importance: z.enum(['critical', 'high', 'medium', 'low']).optional(),
        layer: z.string().optional().describe('Knowledge layer: "business-domain" for pure business rules/concepts, "code-knowledge" for implementation patterns. Extensible.'),
        entities: z.array(z.string()).optional(),
        suggested_relations: z.array(z.object({
          concept: z.string(),
          relation: z.enum(['relates_to', 'depends_on', 'contradicts', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes']),
        })).optional(),
        tags: z.array(z.string()).optional(),
      }).optional().describe('Optional updated metadata fields'),
      reason: z.string().describe('Why this chunk is being updated'),
    },
    async ({ id, new_content, new_metadata, reason }) => {
      const requestId = randomUUID();
      const onStep = eventBus.makeStepEmitter(requestId, 'evolve');
      onStep('start', `Evolve: ${id.slice(0, 8)}...`);
      const t0 = performance.now();
      try {
        const result = await handleEvolve(
          storage, embedder, linker,
          id, new_content, new_metadata, reason, onStep
        );
        onStep('complete', `Evolved to v${result.version}`, { duration_ms: Math.round(performance.now() - t0), version: result.version });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        onStep('error', String(e));
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Start server
  // ============================================================
  log('Starting knowledge-graph MCP server...');
  log(`DB path: ${db.path}`);
  log(`Ollama: ${ollama.url} (model: ${ollama.model})`);
  log(`Config: ~/.knowledge-graph/knowledge.json`);

  // Health check Ollama
  const health = await embedder.healthCheck();
  if (!health.ok) {
    log('WARNING:', health.error);
    log('Server starting anyway — embedding will fail until Ollama is ready.');
  } else {
    log('Ollama health check passed');
  }

  // Initialize storage
  try {
    await storage.initialize();
    log('Storage initialized');

    // Start dashboard HTTP server (unless disabled)
    if (dashCfg.enabled) {
      dashboard.start(dashCfg.port);

      // Register HTTP POST triggers (for E2E testing without MCP)
      dashboard.registerTrigger('query', async (params) => {
        const { query, filters } = params as { query: string; filters?: Record<string, unknown> };
        const requestId = randomUUID();
        const onStep = eventBus.makeStepEmitter(requestId, 'query');
        onStep('start', `Query: "${query.slice(0, 60)}"`);
        const t0 = performance.now();
        const result = await handleQuery(retriever, query, filters as any, onStep);
        onStep('complete', `${result.total} results`, { duration_ms: Math.round(performance.now() - t0), result_count: result.total });
        return result;
      });

      dashboard.registerTrigger('store', async (params) => {
        const { content, metadata } = params as { content: string; metadata: Record<string, unknown> };
        const requestId = randomUUID();
        const onStep = eventBus.makeStepEmitter(requestId, 'store');
        onStep('start', `Store: "${(metadata.summary as string || '').slice(0, 50)}"`);
        const t0 = performance.now();
        const result = await handleStore(storage, embedder, linker, content, metadata as any, onStep, dedup.similarityThreshold);
        onStep('complete', `Stored ${result.id}`, { duration_ms: Math.round(performance.now() - t0), id: result.id, auto_links: result.auto_links.length });
        return result;
      });

      dashboard.registerTrigger('evolve', async (params) => {
        const { id, new_content, new_metadata, reason } = params as { id: string; new_content: string; new_metadata?: Record<string, unknown>; reason: string };
        const requestId = randomUUID();
        const onStep = eventBus.makeStepEmitter(requestId, 'evolve');
        onStep('start', `Evolve: ${id.slice(0, 8)}...`);
        const t0 = performance.now();
        const result = await handleEvolve(storage, embedder, linker, id, new_content, new_metadata as any, reason, onStep);
        onStep('complete', `Evolved to v${result.version}`, { duration_ms: Math.round(performance.now() - t0), version: result.version });
        return result;
      });
    } else {
      log('Dashboard disabled');
    }
  } catch (e) {
    log('ERROR: Failed to initialize storage:', e);
    process.exit(1);
  }

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected via stdio');

  // Graceful shutdown (force-exit on second signal)
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      log('Force exit.');
      process.exit(1);
    }
    shuttingDown = true;
    log('Shutting down...');
    try {
      if (dashCfg.enabled) await dashboard.close();
      await storage.close();
      await server.close();
    } catch (e) {
      log('Shutdown error:', e);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
