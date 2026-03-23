#!/usr/bin/env npx tsx
/**
 * Phase 5B: Mine entity aliases from existing knowledge corpus.
 *
 * Extracts all unique entity names, detects acronym/abbreviation patterns,
 * and outputs a proposed alias registry for user review.
 *
 * Patterns detected:
 *   - "Long Form (ACR)" → ACR → Long Form
 *   - "ACR (Long Form)" → ACR → Long Form  (less common)
 *   - CamelCase entities: "ProductCubit" → "productcubit" alias
 *   - Exact duplicates with different casing
 *
 * Usage:
 *   npx tsx scripts/mine-entity-aliases.ts                          # analyze current project
 *   npx tsx scripts/mine-entity-aliases.ts --project /path/to/dir   # specify project dir
 *   npx tsx scripts/mine-entity-aliases.ts --apply                  # write to config
 */

import { IStorage, createStorage } from '../src/storage/interface.js';
import { loadConfig, CONFIG_PATH } from '../src/config.js';
import { discoverProject } from '../src/project.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const projectDirIdx = args.indexOf('--project');
const projectDir = projectDirIdx >= 0 ? args[projectDirIdx + 1] : process.cwd();

// ============================================================
// Acronym pattern detection
// ============================================================

interface AliasCandidate {
  alias: string;
  canonical: string;
  source: 'acronym-in-parens' | 'long-form-in-parens' | 'case-variant';
  confidence: number;
  found_in: string[];  // chunk IDs where pattern was found
}

/**
 * Detect "Long Form (ACR)" pattern in text.
 * Returns [acronym, longForm] pairs.
 */
function detectAcronymPatterns(text: string): Array<[string, string]> {
  const results: Array<[string, string]> = [];

  // Pattern 1: "Long Form (ACR)" — most common
  // Matches: "Know Your Customer (KYC)", "Application Programming Interface (API)"
  const pattern1 = /([A-Z][a-zA-Z\s]+?)\s*\(([A-Z]{2,8})\)/g;
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    const longForm = match[1].trim();
    const acronym = match[2];
    if (longForm.split(/\s+/).length >= 2) {
      results.push([acronym, longForm]);
    }
  }

  // Pattern 2: "ACR (Long Form)" — less common
  const pattern2 = /\b([A-Z]{2,8})\s*\(([A-Z][a-zA-Z\s]+?)\)/g;
  while ((match = pattern2.exec(text)) !== null) {
    const acronym = match[1];
    const longForm = match[2].trim();
    if (longForm.split(/\s+/).length >= 2 && longForm !== acronym) {
      results.push([acronym, longForm]);
    }
  }

  return results;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.error(`\n🔍 Entity Alias Mining${apply ? ' (APPLY MODE)' : ' (ANALYSIS ONLY)'}`);
  console.error('══════════════════════════════════════════════════\n');

  // Discover project
  const project = discoverProject(projectDir);
  if (!project) {
    console.error(`❌ No .knowledge-graph/ found in ${projectDir}`);
    process.exit(1);
  }
  console.error(`📂 Project: ${project.projectName} (${project.projectDir})`);

  // Check if daemon is running (KuzuDB is single-writer)
  if (existsSync(project.daemonPortFile)) {
    console.error('❌ Daemon appears to be running (daemon.port file exists).');
    console.error('   Stop the daemon first: kg stop');
    process.exit(1);
  }

  const config = loadConfig();
  const existingAliases = config.entityAliases.registry;
  console.error(`📊 Existing aliases: ${Object.keys(existingAliases).length}\n`);

  // Open storage
  const storage = await createStorage('kuzu', project.dbPath);

  try {
    const allChunks = await storage.listChunks({}, 10000);
    const chunks = allChunks.filter(
      c => c.layer !== 'operational' && c.layer !== 'entity-index'
    );

    console.error(`📊 Total chunks scanned: ${chunks.length}`);

    // Step 1: Collect all entity names
    const entityCounts = new Map<string, number>();
    const entityChunks = new Map<string, string[]>(); // entity → chunk IDs

    for (const chunk of chunks) {
      for (const entity of chunk.entities) {
        entityCounts.set(entity, (entityCounts.get(entity) || 0) + 1);
        const ids = entityChunks.get(entity) ?? [];
        ids.push(chunk.id.slice(0, 8));
        entityChunks.set(entity, ids);
      }
    }

    const uniqueEntities = Array.from(entityCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    console.error(`📊 Unique entities: ${uniqueEntities.length}\n`);

    // Print entity frequency table
    console.error('── Entity Frequency ──\n');
    for (const [entity, count] of uniqueEntities) {
      console.error(`  ${String(count).padStart(4)} × ${entity}`);
    }

    // Step 2: Mine acronym patterns from chunk content
    console.error('\n── Acronym Pattern Mining ──\n');
    const candidates: AliasCandidate[] = [];
    const seenPairs = new Set<string>();

    for (const chunk of chunks) {
      const patterns = detectAcronymPatterns(chunk.content);
      for (const [acronym, longForm] of patterns) {
        const key = `${acronym.toLowerCase()}→${longForm.toLowerCase()}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);

        candidates.push({
          alias: acronym,
          canonical: longForm,
          source: 'acronym-in-parens',
          confidence: 0.9,
          found_in: [chunk.id.slice(0, 8)],
        });
      }
    }

    // Step 3: Detect case variants (e.g., "KYC" vs "kyc" vs "Kyc")
    const lowercaseMap = new Map<string, string[]>(); // lowercase → original forms
    for (const [entity] of uniqueEntities) {
      const lower = entity.toLowerCase();
      const variants = lowercaseMap.get(lower) ?? [];
      variants.push(entity);
      lowercaseMap.set(lower, variants);
    }

    for (const [, variants] of Array.from(lowercaseMap)) {
      if (variants.length > 1) {
        // Pick the most common one as canonical
        const sorted = variants.sort(
          (a, b) => (entityCounts.get(b) ?? 0) - (entityCounts.get(a) ?? 0)
        );
        const canonical = sorted[0];
        for (const variant of sorted.slice(1)) {
          if (variant !== canonical) {
            candidates.push({
              alias: variant,
              canonical,
              source: 'case-variant',
              confidence: 0.8,
              found_in: entityChunks.get(variant)?.slice(0, 3) ?? [],
            });
          }
        }
      }
    }

    // Filter out already-registered aliases
    const newCandidates = candidates.filter(
      c => !existingAliases[c.alias.toLowerCase()]
    );

    if (newCandidates.length === 0) {
      console.error('✅ No new alias candidates found.');
      await storage.close();
      return;
    }

    // Print candidates
    console.error(`Found ${newCandidates.length} new alias candidates:\n`);
    for (const c of newCandidates) {
      console.error(
        `  ${c.alias.padEnd(20)} → ${c.canonical.padEnd(30)} ` +
        `[${c.source}, confidence: ${c.confidence}] ` +
        `(found in: ${c.found_in.join(', ')})`
      );
    }

    // Build proposed registry
    const proposedRegistry: Record<string, string> = { ...existingAliases };
    for (const c of newCandidates) {
      proposedRegistry[c.alias.toLowerCase()] = c.canonical;
    }

    // Output as JSON for review
    console.error('\n── Proposed Registry ──\n');
    console.error(JSON.stringify(proposedRegistry, null, 2));

    if (apply) {
      // Write to config
      try {
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        const configObj = JSON.parse(raw);
        if (!configObj.entityAliases) configObj.entityAliases = {};
        configObj.entityAliases.registry = proposedRegistry;
        writeFileSync(CONFIG_PATH, JSON.stringify(configObj, null, 2) + '\n');
        console.error(`\n✅ Written ${newCandidates.length} new aliases to ${CONFIG_PATH}`);
      } catch (e) {
        console.error(`\n❌ Failed to write config: ${e}`);
      }
    } else {
      console.error('\n💡 Run with --apply to write these aliases to config');
      console.error('   Review the proposed registry above first!');
    }
  } finally {
    await storage.close();
  }
}

main().catch((e) => {
  console.error('\n❌ Mining failed:', e);
  process.exit(1);
});
