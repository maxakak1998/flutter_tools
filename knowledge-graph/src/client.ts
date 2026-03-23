/**
 * MCP client — thin stdio-to-HTTP proxy.
 * Speaks MCP protocol to Claude Code via stdio, forwards tool calls to daemon via HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { makeRpcRequest } from './rpc.js';
import { log } from './types.js';
import { getRuntimeVersion } from './version.js';

// ============================================================
// RPC call to daemon
// ============================================================

async function rpcCall(daemonUrl: string, method: string, params: unknown): Promise<unknown> {
  const req = makeRpcRequest(method, params);
  const res = await fetch(`${daemonUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const json = await res.json() as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// ============================================================
// Tool schemas (Zod validation before forwarding to daemon)
// ============================================================

const categoryEnum = z.enum(['fact', 'rule', 'insight', 'question', 'workflow']);
const importanceEnum = z.enum(['critical', 'high', 'medium', 'low']);
const lifecycleEnum = z.enum(['hypothesis', 'validated', 'promoted', 'canonical', 'refuted', 'active']);
const relationEnum = z.enum(['relates_to', 'depends_on', 'contradicts', 'supersedes', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes', 'transitions_to', 'governed_by']);
const suggestedRelationEnum = z.enum(['relates_to', 'depends_on', 'contradicts', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes', 'transitions_to', 'governed_by']);

const entitySchema = z.union([
  z.string().min(2),
  z.object({ name: z.string().min(2), alias: z.string().min(1).optional() }),
]);

const storeRelationSchema = z.object({
  from_entity: z.string().min(2),
  to_entity: z.string().min(2),
  relation: suggestedRelationEnum,
});

const metadataSchema = z.object({
  summary: z.string().min(1).max(200),
  keywords: z.array(z.string().min(2)).min(1).max(15),
  domain: z.string().max(50),
  category: categoryEnum,
  importance: importanceEnum,
  layer: z.string().optional(),
  entities: z.array(entitySchema).max(4).optional(),
  relations: z.array(storeRelationSchema).max(4).optional(),
  suggested_relations: z.array(z.object({
    concept: z.string(),
    relation: suggestedRelationEnum,
  })).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
});

// ============================================================
// Client main
// ============================================================

export async function clientMain(daemonUrl: string, projectId: string): Promise<void> {
  // Register with daemon
  await fetch(`${daemonUrl}/rpc/connect`, { method: 'POST' });

  const server = new McpServer({ name: 'knowledge-graph', version: getRuntimeVersion() });

  // Helper: proxy tool call to daemon
  function proxyTool(
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    methodName: string,
  ) {
    server.tool(name, description, schema, async (params) => {
      try {
        const result = await rpcCall(daemonUrl, methodName, params);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    });
  }

  // ============================================================
  // Register all tools (proxy to daemon)
  // ============================================================

  proxyTool(
    'knowledge_query',
    'Search knowledge base using semantic + graph retrieval.',
    {
      query: z.string().describe('Natural language search query'),
      filters: z.object({
        domain: z.string().optional(),
        category: categoryEnum.optional(),
        importance: importanceEnum.optional(),
        tags: z.array(z.string()).optional(),
        layer: z.string().optional(),
        min_confidence: z.number().min(0).max(1).optional(),
        lifecycle: lifecycleEnum.optional(),
        since: z.string().optional(),
      }).optional(),
    },
    'knowledge_query',
  );

  proxyTool(
    'knowledge_store',
    'Store a business logic insight as a knowledge chunk. Content should be natural language describing domain rules, business constraints, workflow rationale, or cross-feature relationships — NOT code patterns, class names, or technical implementation details. Ask the user to confirm uncertain inferences before storing. ENTITY RULES: Max 4 entities per chunk. If 2+ entities, MUST include relations[] describing how they interact. Use EntityObject {name, alias} format for entities with abbreviations.',
    { content: z.string().min(1).max(5000), metadata: metadataSchema },
    'knowledge_store',
  );

  proxyTool(
    'knowledge_link',
    'Create a relationship between two knowledge chunks.',
    {
      source_id: z.string(),
      target_id: z.string(),
      relation: relationEnum,
    },
    'knowledge_link',
  );

  proxyTool(
    'knowledge_list',
    'Browse knowledge chunks by filters.',
    {
      filters: z.object({
        domain: z.string().optional(),
        category: categoryEnum.optional(),
        importance: importanceEnum.optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        layer: z.string().optional(),
        min_confidence: z.number().min(0).max(1).optional(),
        lifecycle: lifecycleEnum.optional(),
        since: z.string().optional(),
      }).optional(),
      limit: z.number().optional(),
    },
    'knowledge_list',
  );

  proxyTool(
    'knowledge_delete',
    'Delete a knowledge chunk and all its relationships. Validated/promoted/canonical chunks require a reason.',
    { id: z.string(), reason: z.string().optional() },
    'knowledge_delete',
  );

  proxyTool(
    'knowledge_evolve',
    'Update a knowledge chunk: re-embed, version bump, re-link.',
    {
      id: z.string(),
      new_content: z.string().min(1).max(5000),
      new_metadata: z.object({
        summary: z.string().min(1).max(200).optional(),
        keywords: z.array(z.string().min(2)).min(1).max(15).optional(),
        domain: z.string().max(50).optional(),
        category: categoryEnum.optional(),
        importance: importanceEnum.optional(),
        layer: z.string().optional(),
        entities: z.array(entitySchema).max(4).optional(),
        relations: z.array(storeRelationSchema).max(4).optional(),
        suggested_relations: z.array(z.object({
          concept: z.string(),
          relation: suggestedRelationEnum,
        })).optional(),
        tags: z.array(z.string()).optional(),
      }).optional(),
      reason: z.string(),
    },
    'knowledge_evolve',
  );

  proxyTool(
    'knowledge_validate',
    'Confirm or refute a knowledge chunk. Always include evidence. See CLAUDE.md Validation Policy for golden evidence framework.',
    {
      id: z.string(),
      action: z.enum(['confirm', 'refute']),
      evidence: z.string().optional(),
      context: z.string().optional(),
    },
    'knowledge_validate',
  );

  proxyTool(
    'knowledge_promote',
    'Promote a knowledge chunk to higher status. Caller should verify golden evidence sources. See CLAUDE.md Validation Policy.',
    {
      id: z.string(),
      new_category: categoryEnum.optional(),
      new_importance: importanceEnum.optional(),
      reason: z.string(),
    },
    'knowledge_promote',
  );

  proxyTool(
    'knowledge_briefing',
    'Generate a domain overview briefing from the knowledge graph: domain summaries, stats, open questions, recent changes, stale knowledge. Use at session start for context.',
    {
      top_domains: z.number().optional().describe('Max domains to include'),
      recent_days: z.number().optional().describe('Days to look back for recent changes'),
    },
    'knowledge_briefing',
  );

  proxyTool(
    'knowledge_export',
    'Export knowledge graph as formatted markdown or JSON, grouped by domain/category/lifecycle.',
    {
      group_by: z.enum(['domain', 'category', 'lifecycle']).default('domain'),
      min_lifecycle: z.enum(['refuted', 'hypothesis', 'active', 'validated', 'promoted', 'canonical']).optional(),
      format: z.enum(['markdown', 'json']).default('markdown'),
      include_content: z.boolean().default(true),
    },
    'knowledge_export',
  );

  proxyTool(
    'knowledge_ingest',
    'Chunk raw text into knowledge candidates. Does NOT auto-store — returns candidates for review. Claude must interview the user before storing each candidate.',
    {
      content: z.string().min(1).max(50000).describe('Raw text to chunk and analyze'),
      source: z.string().optional().describe('Origin of the text'),
      domain_hint: z.string().max(50).optional().describe('Suggested domain'),
    },
    'knowledge_ingest',
  );

  // ============================================================
  // Life Knowledge tools (operational layer)
  // ============================================================

  const lifeMetadataSchema = z.object({
    summary: z.string().min(1).max(200),
    keywords: z.array(z.string().min(2)).min(1).max(15),
    domain: z.string().max(50),
    category: z.enum(['fact', 'rule', 'insight', 'workflow']),
    importance: importanceEnum,
    tags: z.array(z.string()).optional(),
    entities: z.array(z.string().min(2)).optional(),
    source: z.string().optional(),
  });

  proxyTool(
    'life_store',
    'Store an operational learning (coding gotcha, pattern, workaround). NOT for domain/business knowledge — use knowledge_store for that. Requires at least one life:* tag.',
    { content: z.string().min(1).max(5000), metadata: lifeMetadataSchema },
    'life_store',
  );

  proxyTool(
    'life_feedback',
    'Report success or failure after applying an operational learning. Adjusts score: +1 for success, -1 for failure. Score 0 = hidden, score 10 = skill-eligible.',
    { id: z.string(), outcome: z.enum(['success', 'failure']), context: z.string().optional() },
    'life_feedback',
  );

  proxyTool(
    'life_draft_skill',
    'Generate a draft Claude skill from high-score operational learnings in a domain. Does NOT auto-install — returns draft content for review.',
    { domain: z.string(), target_skill_path: z.string().optional(), force: z.boolean().optional() },
    'life_draft_skill',
  );

  // ============================================================
  // Connect to stdio transport
  // ============================================================

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`MCP client connected (project: ${projectId}, daemon: ${daemonUrl})`);

  // SIGINT (Ctrl+C): user explicitly wants to stop everything — kill daemon
  process.on('SIGINT', async () => {
    try {
      await fetch(`${daemonUrl}/rpc/shutdown`, { method: 'POST' }).catch(() => {});
      await server.close();
    } catch { /* ignore */ }
    process.exit(0);
  });

  // SIGTERM (Claude Code exiting): preserve daemon for other sessions
  process.on('SIGTERM', async () => {
    try {
      await fetch(`${daemonUrl}/rpc/disconnect`, { method: 'POST' }).catch(() => {});
      await server.close();
    } catch { /* ignore */ }
    process.exit(0);
  });
}
