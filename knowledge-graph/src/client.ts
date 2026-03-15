/**
 * MCP client — thin stdio-to-HTTP proxy.
 * Speaks MCP protocol to Claude Code via stdio, forwards tool calls to daemon via HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { makeRpcRequest } from './rpc.js';
import { log } from './types.js';

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
const relationEnum = z.enum(['relates_to', 'depends_on', 'contradicts', 'supersedes', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes', 'is_true', 'is_false', 'transitions_to', 'mutates', 'governed_by']);
const suggestedRelationEnum = z.enum(['relates_to', 'depends_on', 'contradicts', 'triggers', 'requires', 'produces', 'is_part_of', 'constrains', 'precedes', 'is_true', 'is_false', 'transitions_to', 'mutates', 'governed_by']);

const metadataSchema = z.object({
  summary: z.string().min(1).max(200),
  keywords: z.array(z.string().min(2)).min(1).max(15),
  domain: z.string().max(50),
  category: categoryEnum,
  importance: importanceEnum,
  layer: z.string().optional(),
  entities: z.array(z.string().min(2)).optional(),
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

  const server = new McpServer({ name: 'knowledge-graph', version: '1.0.0' });

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
    'Store a new knowledge chunk with metadata.',
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
    'Delete a knowledge chunk and all its relationships.',
    { id: z.string() },
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
        entities: z.array(z.string().min(2)).optional(),
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
    'Promote a knowledge chunk to higher status. Requires all 4 golden evidence sources verified. See CLAUDE.md Validation Policy.',
    {
      id: z.string(),
      new_category: categoryEnum.optional(),
      new_importance: importanceEnum.optional(),
      reason: z.string(),
    },
    'knowledge_promote',
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
