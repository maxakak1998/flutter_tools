#!/usr/bin/env npx tsx

/**
 * activity.log rotation + per-turn event test.
 *
 * Part A (source, pure fs): rotateIfLarge/appendActivity — over the cap the log
 * moves to activity.log.1 (replacing the old .1), under the cap nothing moves.
 * Part B (bash): installs the hooks with scripts/setup-hooks.sh into a TEMP project
 * and runs the generated kg-activity-tracker.sh (rotates, same env cap) and
 * kg-learning-capture-check.sh (Stop hook → event "turn_stop", not "session_stop").
 * Requires jq. Never touches a real project.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { rotateIfLarge, appendActivity } from '../src/activity-log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, 'utf-8').split('\n').filter(Boolean) : [];
}

function partA(dir: string): void {
  console.error('\n📋 Part A: rotateIfLarge / appendActivity');
  const log = join(dir, 'activity.log');
  writeFileSync(log, 'x'.repeat(50) + '\n');
  assert(rotateIfLarge(log, 100) === false && !existsSync(`${log}.1`), 'under the cap → no rotation');
  assert(rotateIfLarge(join(dir, 'missing.log'), 1) === false, 'missing file → no rotation, no throw');

  writeFileSync(log, 'old-1\n' + 'y'.repeat(200) + '\n');
  process.env.KG_ACTIVITY_LOG_MAX_BYTES = '100';
  appendActivity(log, { event: 'session_start', n: 1 });
  assert(lines(`${log}.1`)[0] === 'old-1', 'over the cap → old content moved to activity.log.1');
  assert(lines(log).length === 1 && JSON.parse(lines(log)[0]).n === 1, 'new entry starts a fresh activity.log');

  writeFileSync(log, 'old-2\n' + 'z'.repeat(200) + '\n');
  appendActivity(log, { event: 'session_start', n: 2 });
  assert(lines(`${log}.1`)[0] === 'old-2', 'second rotation replaces activity.log.1 (keeps ONE previous file)');
  assert(!existsSync(`${log}.2`), 'no activity.log.2 is ever created');
  delete process.env.KG_ACTIVITY_LOG_MAX_BYTES;
}

function partB(): void {
  console.error('\n📋 Part B: generated hook scripts (setup-hooks.sh into a temp project)');
  if (spawnSync('jq', ['--version']).status !== 0) {
    assert(false, 'jq is installed (required by the hooks)');
    return;
  }
  const projectDir = mkdtempSync(join(tmpdir(), 'kg-activity-hooks-'));
  try {
    const kgDir = join(projectDir, '.knowledge-graph');
    mkdirSync(kgDir, { recursive: true });
    const setup = spawnSync('bash', [join(__dirname, 'setup-hooks.sh')], { cwd: projectDir, encoding: 'utf-8' });
    assert(setup.status === 0, 'setup-hooks.sh succeeds in a temp project', (setup.stderr || setup.stdout).slice(-300));
    const hooks = join(projectDir, '.claude', 'hooks');
    const log = join(kgDir, 'activity.log');
    const sid = 'activity-log-test-session';
    const env = { ...process.env, KG_ACTIVITY_LOG_MAX_BYTES: '300' };

    writeFileSync(log, 'legacy-line\n' + 'q'.repeat(400) + '\n');
    const tracker = spawnSync('bash', [join(hooks, 'kg-activity-tracker.sh')], {
      cwd: projectDir,
      env,
      input: JSON.stringify({ session_id: sid, tool_name: 'Grep', tool_input: { pattern: 'foo', path: '.' } }),
      encoding: 'utf-8',
    });
    assert(tracker.status === 0, 'kg-activity-tracker.sh exits 0', tracker.stderr);
    assert(lines(`${log}.1`)[0] === 'legacy-line', 'tracker hook rotated the oversized log to activity.log.1');
    const fresh = lines(log);
    assert(fresh.length === 1 && JSON.parse(fresh[0]).tool === 'Grep', 'tracker hook appended its event to a fresh activity.log', fresh.join(' | '));

    const small = spawnSync('bash', [join(hooks, 'kg-activity-tracker.sh')], {
      cwd: projectDir,
      env,
      input: JSON.stringify({ session_id: sid, tool_name: 'Bash', tool_input: { command: 'ls' } }),
      encoding: 'utf-8',
    });
    assert(small.status === 0 && lines(log).length === 2 && lines(`${log}.1`)[0] === 'legacy-line', 'under the cap the tracker just appends (no rotation)');

    const stop = spawnSync('bash', [join(hooks, 'kg-learning-capture-check.sh')], {
      cwd: projectDir,
      env,
      input: JSON.stringify({ session_id: sid }),
      encoding: 'utf-8',
    });
    assert(stop.status === 0, 'Stop hook exits 0', stop.stderr);
    const events = lines(log).map((l) => JSON.parse(l).event);
    assert(events.includes('turn_stop'), 'Stop hook logs event "turn_stop"', JSON.stringify(events));
    assert(!events.includes('session_stop'), 'Stop hook no longer logs the misleading "session_stop"');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function main(): void {
  console.error('🧪 activity.log rotation test');
  console.error('═'.repeat(50));
  const dir = mkdtempSync(join(tmpdir(), 'kg-activity-log-'));
  try {
    partA(dir);
    partB();
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.error('═'.repeat(50));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
