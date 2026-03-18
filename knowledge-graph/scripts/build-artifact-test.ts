#!/usr/bin/env npx tsx

/**
 * Build artifact integrity test.
 * Verifies dist/ contains exactly the expected outputs from src/ plus copied assets.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const projectRoot = new URL('..', import.meta.url).pathname;
const srcDir = join(projectRoot, 'src');
const distDir = join(projectRoot, 'dist');

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.error(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (stats.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function toRelativeSet(baseDir: string, files: string[]): Set<string> {
  return new Set(files.map(file => relative(baseDir, file)));
}

function expectedBuildArtifacts(srcFiles: Set<string>): Set<string> {
  const expected = new Set<string>();

  for (const file of srcFiles) {
    if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      const base = file.slice(0, -3);
      expected.add(`${base}.js`);
      expected.add(`${base}.js.map`);
      expected.add(`${base}.d.ts`);
      expected.add(`${base}.d.ts.map`);
    }
  }

  expected.add('dashboard/index.html');
  return expected;
}

function main(): void {
  console.error('🧪 Build Artifact Integrity Test');
  console.error('═'.repeat(50));

  const srcFiles = toRelativeSet(srcDir, walkFiles(srcDir));
  const distFiles = toRelativeSet(distDir, walkFiles(distDir));
  const expectedFiles = expectedBuildArtifacts(srcFiles);

  assert(distFiles.size > 0, 'dist directory is not empty');

  const missingFiles = [...expectedFiles].filter(file => !distFiles.has(file)).sort();
  const orphanedFiles = [...distFiles].filter(file => !expectedFiles.has(file)).sort();

  assert(missingFiles.length === 0, 'All expected dist artifacts exist', missingFiles.slice(0, 10).join(', '));
  assert(orphanedFiles.length === 0, 'No orphaned files remain in dist', orphanedFiles.slice(0, 10).join(', '));

  const tsSourceCount = [...srcFiles].filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts')).length;
  assert(
    expectedFiles.size === tsSourceCount * 4 + 1,
    'Expected artifact count matches source file count',
    `expected=${tsSourceCount * 4 + 1}, actual=${expectedFiles.size}`,
  );

  const newCriticalOutputs = ['http-utils.js', 'version.js', 'dashboard/index.html'];
  for (const file of newCriticalOutputs) {
    assert(distFiles.has(file), `Critical artifact present: ${file}`);
  }

  console.error('═'.repeat(50));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
