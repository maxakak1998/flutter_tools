#!/usr/bin/env npx tsx
/**
 * Phase 5A: Backfill entity-index chunks for existing knowledge.
 *
 * Opens the project DB directly (no daemon needed), iterates all non-operational/
 * non-entity-index chunks with entities[], creates entity-index chunks, and
 * links them via IS_PART_OF edges.
 *
 * Usage:
 *   npx tsx scripts/migrate-entities.ts                          # dry-run (default)
 *   npx tsx scripts/migrate-entities.ts --apply                  # actually write to DB
 *   npx tsx scripts/migrate-entities.ts --project /path/to/dir   # specify project dir
 *
 * Requires: Ollama running with bge-m3 model (for embedding entity-index chunks).
 */

import { IStorage, createStorage } from '../src/storage/interface.js';
import { Embedder } from '../src/engine/embedder.js';
import { loadConfig } from '../src/config.js';
import { discoverProject } from '../src/project.js';
import { EntityAliasRegistry } from '../src/entity-registry.js';
import { StoredChunk } from '../src/types.js';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const projectDirIdx = args.indexOf('--project');
const projectDir = projectDirIdx >= 0 ? args[projectDirIdx + 1] : process.cwd();

// ============================================================
// Helpers
// ============================================================

function toKebabCase(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const LIFECYCLE_PRIORITY: Record<string, number> = {
  canonical: 0,
  promoted: 1,
  validated: 2,
  active: 3,
  hypothesis: 4,
  refuted: 5,
};

// ============================================================
// Main
// ============================================================

async function main() {
  console.error(`\n🔄 Entity Migration${dryRun ? ' (DRY RUN)' : ' (APPLY MODE)'}`);
  console.error('══════════════════════════════════════════════════\n');

  // Discover project
  const project = discoverProject(projectDir);
  if (!project) {
    console.error(`❌ No .knowledge-graph/ found in ${projectDir}`);
    console.error('   Run "kg init" first, or use --project /path/to/dir');
    process.exit(1);
  }
  console.error(`📂 Project: ${project.projectName} (${project.projectDir})`);
  console.error(`📂 DB path: ${project.dbPath}\n`);

  // Check if daemon is running (KuzuDB is single-writer)
  if (existsSync(project.daemonPortFile)) {
    console.error('❌ Daemon appears to be running (daemon.port file exists).');
    console.error('   Stop the daemon first: kg stop');
    process.exit(1);
  }

  // Load config and alias registry
  const config = loadConfig();
  const registry = new EntityAliasRegistry(config.entityAliases.registry);

  // Open storage directly
  const storage = await createStorage('kuzu', project.dbPath);
  const embedder = new Embedder(config.ollama.url, config.ollama.model, 5000);

  // Health check
  const health = await embedder.healthCheck();
  if (!health.ok) {
    console.error(`❌ Ollama not available: ${health.error}`);
    console.error('   Start Ollama and pull bge-m3 before running migration.');
    await storage.close();
    process.exit(1);
  }

  try {
    // List all chunks (exclude operational and entity-index)
    const allChunks = await storage.listChunks({}, 10000);
    const chunks = allChunks.filter(
      c => c.layer !== 'operational' && c.layer !== 'entity-index'
    );

    console.error(`📊 Total chunks: ${allChunks.length}`);
    console.error(`📊 Non-operational/non-entity-index: ${chunks.length}`);

    // Filter to chunks with non-empty entities
    const withEntities = chunks.filter(c => c.entities && c.entities.length > 0);
    console.error(`📊 Chunks with entities: ${withEntities.length}\n`);

    if (withEntities.length === 0) {
      console.error('✅ No chunks with entities found. Nothing to migrate.');
      await storage.close();
      return;
    }

    // Sort by lifecycle priority (process highest-trust chunks first)
    withEntities.sort((a, b) => {
      const pa = LIFECYCLE_PRIORITY[a.lifecycle] ?? 99;
      const pb = LIFECYCLE_PRIORITY[b.lifecycle] ?? 99;
      return pa - pb;
    });

    // Collect unique entities
    const allEntities = new Set<string>();
    for (const chunk of withEntities) {
      for (const entity of chunk.entities) {
        const canonical = registry.resolve(entity);
        allEntities.add(canonical);
      }
    }
    console.error(`📊 Unique entities: ${allEntities.size}`);

    // Phase 1: Create entity-index chunks
    console.error('\n── Phase 1: Create entity-index chunks ──\n');
    const entityChunkMap = new Map<string, string>(); // canonical name → chunk ID
    let created = 0;
    let skipped = 0;

    for (const entityName of Array.from(allEntities)) {
      const domain = toKebabCase(entityName);

      // Check if entity-index chunk already exists
      const existing = await storage.listChunks({ layer: 'entity-index', domain }, 1);
      if (existing.length > 0) {
        entityChunkMap.set(entityName, existing[0].id);
        console.error(`  ⏭️  ${entityName} → already exists (${existing[0].id.slice(0, 8)})`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.error(`  🔍 ${entityName} → would create entity-index chunk`);
        entityChunkMap.set(entityName, `dry-run-${entityName}`);
        created++;
        continue;
      }

      // Create entity-index chunk
      const content = `Entity: ${entityName}`;
      const embedding = await embedder.embed(content);
      const id = randomUUID();

      const aliases: string[] = [];
      for (const [alias, canonical] of Object.entries(registry.allAliases())) {
        if (canonical === entityName) aliases.push(alias);
      }

      await storage.createChunk({
        id,
        content,
        summary: `Entity index: ${entityName}`,
        embedding,
        source: null,
        category: 'fact',
        domain,
        importance: 'medium',
        layer: 'entity-index',
        keywords: [entityName.toLowerCase(), ...aliases.map(a => a.toLowerCase())]
          .filter((v, i, arr) => arr.indexOf(v) === i),
        entities: [entityName],
        tags: ['entity-index'],
        version: 1,
        confidence: 0.5,
        validation_count: 0,
        refutation_count: 0,
        last_validated_at: '',
        lifecycle: 'active',
        access_count: 0,
      });

      entityChunkMap.set(entityName, id);
      console.error(`  ✅ ${entityName} → created (${id.slice(0, 8)})`);
      created++;
    }

    console.error(`\n  Created: ${created}, Skipped (existing): ${skipped}`);

    // Phase 2: Create IS_PART_OF edges
    console.error('\n── Phase 2: Create IS_PART_OF edges ──\n');
    let edgesCreated = 0;
    let edgeErrors = 0;

    for (const chunk of withEntities) {
      for (const entity of chunk.entities) {
        const canonical = registry.resolve(entity);
        const entityChunkId = entityChunkMap.get(canonical);
        if (!entityChunkId) continue;

        if (dryRun) {
          console.error(`  🔍 ${chunk.id.slice(0, 8)} ──IS_PART_OF──▶ ${canonical}`);
          edgesCreated++;
          continue;
        }

        try {
          await storage.createRelation(chunk.id, entityChunkId, 'IS_PART_OF');
          edgesCreated++;
        } catch (e) {
          // Edge might already exist — that's OK
          edgeErrors++;
        }
      }
    }

    console.error(`\n  Edges: ${edgesCreated} created, ${edgeErrors} errors/duplicates`);

    // Summary
    console.error('\n══════════════════════════════════════════════════');
    console.error(`📊 Migration Summary${dryRun ? ' (DRY RUN — no changes written)' : ''}:`);
    console.error(`   Entity-index chunks: ${created} created, ${skipped} existing`);
    console.error(`   IS_PART_OF edges: ${edgesCreated} created`);
    console.error(`   Chunks processed: ${withEntities.length}`);
    console.error(`   Processing order: ${Object.keys(LIFECYCLE_PRIORITY).join(' → ')}`);

    if (dryRun) {
      console.error('\n💡 Run with --apply to write changes to DB');
    } else {
      console.error('\n✅ Migration complete');
    }
  } finally {
    await storage.close();
  }
}

main().catch((e) => {
  console.error('\n❌ Migration failed:', e);
  process.exit(1);
});
