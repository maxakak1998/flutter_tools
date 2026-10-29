#!/usr/bin/env npx tsx

/**
 * Daemon lifecycle integration test.
 *
 * IMPORTANT: This test runs against built dist/ files because daemon-manager
 * forks daemon.js directly.
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { ensureDaemon } from '../dist/daemon-manager.js';
import { loadConfig } from '../dist/config.js';
import { rpcCall, DaemonUnreachableError } from '../dist/client.js';
import { DAEMON_SHUTTING_DOWN_MESSAGE } from '../dist/types.js';

interface ProjectConfig {
  version: number;
  project_id: string;
  project_name: string;
  created_at: string;
  daemon: {
    port_range_start: number;
    idle_timeout_ms: number;
  };
  overrides: Record<string, unknown>;
}

interface ProjectInfo {
  projectId: string;
  projectName: string;
  projectDir: string;
  kgDir: string;
  dbPath: string;
  configPath: string;
  daemonPortFile: string;
  daemonPidFile: string;
  config: ProjectConfig;
}

interface HealthResponse {
  status: string;
  project_id: string;
  clients: number;
  uptime_ms: number;
  startup_import?: string;
}

// Raw JSON-RPC POST (no client-side mapping) → { result } | { error }.
async function rawRpc(baseUrl: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${baseUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params: { client_session_id: 'daemon-it', ...params }, id: 1 }),
  });
  return res.json();
}

async function connectAs(baseUrl: string, sessionId: string, pid?: number): Promise<any> {
  const res = await fetch(`${baseUrl}/rpc/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, ...(pid ? { pid } : {}) }),
  });
  return res.json();
}

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

function createTestProject(): ProjectInfo {
  const projectDir = mkdtempSync(join(tmpdir(), 'kg-daemon-test-'));
  const kgDir = join(projectDir, '.knowledge-graph');
  mkdirSync(join(kgDir, 'data'), { recursive: true });

  const config: ProjectConfig = {
    version: 1,
    project_id: randomUUID(),
    project_name: 'daemon-integration-test',
    created_at: new Date().toISOString(),
    daemon: {
      port_range_start: 0,
      idle_timeout_ms: 60_000,
    },
    overrides: {},
  };

  const configPath = join(kgDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  return {
    projectId: config.project_id,
    projectName: config.project_name,
    projectDir,
    kgDir,
    dbPath: join(kgDir, 'data', 'knowledge'),
    configPath,
    daemonPortFile: join(kgDir, 'daemon.port'),
    daemonPidFile: join(kgDir, 'daemon.pid'),
    config,
  };
}

async function getHealth(baseUrl: string): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return null;
    return await res.json() as HealthResponse;
  } catch {
    return null;
  }
}

async function postJson(baseUrl: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function shutdownDaemon(baseUrl: string | null): Promise<void> {
  if (!baseUrl) return;

  try {
    await fetch(`${baseUrl}/rpc/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1_500) });
  } catch {
    // Ignore shutdown races.
  }

  await waitFor(async () => (await getHealth(baseUrl)) === null, 10_000);
}

async function main() {
  console.error('🧪 Daemon Integration Test');
  console.error('═'.repeat(50));

  const project = createTestProject();
  const config = loadConfig();
  let daemonUrl: string | null = null;

  try {
    console.error('\n📋 Test 1: startup + health');
    daemonUrl = await ensureDaemon(project as any, config);
    assert(daemonUrl.startsWith('http://127.0.0.1:'), 'Daemon starts on localhost URL', daemonUrl);
    assert(existsSync(project.daemonPortFile), 'daemon.port file created');
    assert(existsSync(project.daemonPidFile), 'daemon.pid file created');

    const health = await getHealth(daemonUrl);
    assert(health?.status === 'ok', 'Health endpoint reports ok', `got: ${health?.status}`);
    assert(health?.project_id === project.projectId, 'Health endpoint returns matching project ID', `got: ${health?.project_id}`);
    assert(health?.clients === 0, 'Daemon starts with zero clients', `got: ${health?.clients}`);
    assert(typeof health?.uptime_ms === 'number' && health.uptime_ms >= 0, 'Health endpoint returns uptime', `got: ${health?.uptime_ms}`);

    console.error('\n📋 Test 2: connect/disconnect');
    const connectResult = await postJson(daemonUrl, '/rpc/connect');
    assert(connectResult.status === 200, 'Connect endpoint returns 200', `got: ${connectResult.status}`);
    assert(connectResult.body?.ok === true, 'Connect endpoint returns ok=true');
    assert(connectResult.body?.clients === 1, 'Connect increments client count to 1', `got: ${connectResult.body?.clients}`);

    const healthAfterConnect = await getHealth(daemonUrl);
    assert(healthAfterConnect?.clients === 1, 'Health reflects connected client', `got: ${healthAfterConnect?.clients}`);

    const disconnectResult = await postJson(daemonUrl, '/rpc/disconnect');
    assert(disconnectResult.status === 200, 'Disconnect endpoint returns 200', `got: ${disconnectResult.status}`);
    assert(disconnectResult.body?.ok === true, 'Disconnect endpoint returns ok=true');
    assert(disconnectResult.body?.clients === 0, 'Disconnect decrements client count to 0', `got: ${disconnectResult.body?.clients}`);

    const healthAfterDisconnect = await getHealth(daemonUrl);
    assert(healthAfterDisconnect?.clients === 0, 'Health reflects zero connected clients', `got: ${healthAfterDisconnect?.clients}`);

    console.error('\n📋 Test 3: shutdown');
    const shutdownResult = await postJson(daemonUrl, '/rpc/shutdown');
    assert(shutdownResult.status === 200, 'Shutdown endpoint returns 200', `got: ${shutdownResult.status}`);
    assert(shutdownResult.body?.ok === true, 'Shutdown endpoint returns ok=true');

    const stopped = await waitFor(async () => (await getHealth(daemonUrl!)) === null, 10_000);
    assert(stopped, 'Daemon stops after shutdown request');
    assert(!existsSync(project.daemonPortFile), 'daemon.port removed after shutdown');
    assert(!existsSync(project.daemonPidFile), 'daemon.pid removed after shutdown');
    daemonUrl = null;

    console.error('\n📋 Test 4: stale PID cleanup');
    const stalePid = '999999';
    writeFileSync(project.daemonPidFile, stalePid);
    assert(existsSync(project.daemonPidFile), 'Stale PID file prepared for cleanup');

    daemonUrl = await ensureDaemon(project as any, config);
    const restartedHealth = await getHealth(daemonUrl);
    assert(restartedHealth?.status === 'ok', 'Daemon restarts when stale PID file exists', `got: ${restartedHealth?.status}`);

    const rewrittenPid = readFileSync(project.daemonPidFile, 'utf-8').trim();
    assert(rewrittenPid !== stalePid, 'Stale PID file was replaced', `got: ${rewrittenPid}`);
    assert(Number.parseInt(rewrittenPid, 10) > 0, 'Rewritten PID file contains a valid PID', `got: ${rewrittenPid}`);
    await shutdownDaemon(daemonUrl);
    daemonUrl = null;

    // The forked daemon inherits process.env. The delay stretches the startup-import
    // mutex slot (production: importAll over ~3000 sync files took 48-127s).
    const IMPORT_DELAY_MS = 5_000;
    process.env.KG_TEST_STARTUP_IMPORT_DELAY_MS = String(IMPORT_DELAY_MS);
    process.env.KG_SESSION_REAP_MS = '300';

    console.error('\n📋 Test 5: startup import does not block listen; RPCs queue behind it');
    let t0 = Date.now();
    daemonUrl = await ensureDaemon(project as any, config);
    const spawnMs = Date.now() - t0;
    assert(spawnMs < IMPORT_DELAY_MS, 'ensureDaemon returns before the startup import finishes', `took ${spawnMs}ms`);
    const hImporting = await getHealth(daemonUrl);
    assert(hImporting?.status === 'ok' && hImporting?.startup_import === 'running', 'Health is ok and reports startup_import=running', JSON.stringify(hImporting));
    t0 = Date.now();
    const queued = await rawRpc(daemonUrl, 'state_sessions');
    const queuedMs = Date.now() - t0;
    assert(queued.result !== undefined && !queued.error, 'RPC sent during import succeeds', JSON.stringify(queued).slice(0, 120));
    assert(queuedMs >= IMPORT_DELAY_MS - spawnMs - 1_500, 'RPC waited for the import (mutex-serialized, no overlap)', `waited ${queuedMs}ms`);
    const hDone = await getHealth(daemonUrl);
    assert(hDone?.startup_import === 'done', 'Health reports startup_import=done afterwards', `got: ${hDone?.startup_import}`);

    console.error('\n📋 Test 6: client count — re-connect does not double count; dead pids are reaped');
    const live = randomUUID();
    await connectAs(daemonUrl, live, process.pid);
    const again = await connectAs(daemonUrl, live, process.pid);
    assert(again.clients === 1, 'Re-connect of the same session keeps clients=1 (revive path)', `got: ${again.clients}`);
    const deadChild = spawnSync(process.execPath, ['-e', '0']);
    const deadPid = deadChild.pid!;
    const withDead = await connectAs(daemonUrl, randomUUID(), deadPid);
    assert(withDead.clients === 2, 'Session with a dead pid is counted at first', `got: ${withDead.clients}`);
    const reaped = await waitFor(async () => (await getHealth(daemonUrl!))?.clients === 1, 5_000);
    assert(reaped, 'Session whose pid is gone is reaped (clients back to 1)', `clients=${(await getHealth(daemonUrl))?.clients}`);
    await shutdownDaemon(daemonUrl);
    daemonUrl = null;

    console.error('\n📋 Test 7: shutdown with RPCs in flight → fast refusal, no "Storage is closing"');
    daemonUrl = await ensureDaemon(project as any, config);
    const dyingUrl = daemonUrl;
    const dyingPid = readFileSync(project.daemonPidFile, 'utf-8').trim();
    const inFlight = rawRpc(dyingUrl, 'state_sessions'); // queued behind the delayed import
    await postJson(dyingUrl, '/rpc/shutdown');
    await new Promise((r) => setTimeout(r, 400));
    const hDying = await getHealth(dyingUrl);
    assert(hDying?.status === 'shutting_down', 'Health reports shutting_down while draining', `got: ${hDying?.status}`);
    let refusal: unknown = null;
    try {
      await rpcCall(dyingUrl, 'state_sessions', { client_session_id: 'daemon-it' });
    } catch (e) {
      refusal = e;
    }
    assert(refusal instanceof DaemonUnreachableError, 'New RPC is refused and the client maps it to DaemonUnreachableError (→ revive)', String(refusal));
    // ensureDaemon must not adopt the dying daemon: it waits for exit, then spawns.
    const reviveP = ensureDaemon(project as any, config);
    const queuedResult = await inFlight;
    assert(queuedResult.error?.message === DAEMON_SHUTTING_DOWN_MESSAGE, 'RPC queued at shutdown fails fast with the shutting-down message', JSON.stringify(queuedResult).slice(0, 160));
    daemonUrl = await reviveP;
    const newPid = readFileSync(project.daemonPidFile, 'utf-8').trim();
    const hNew = await getHealth(daemonUrl);
    assert(hNew?.status === 'ok' && newPid !== dyingPid, 'ensureDaemon during shutdown returns a FRESH daemon', `pid ${dyingPid} -> ${newPid}, status=${hNew?.status}`);
    const logText = readFileSync(join(project.kgDir, 'logs', 'daemon.log'), 'utf-8');
    assert(!logText.includes('Storage is closing'), 'No "Storage is closing" failure in daemon.log');
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    delete process.env.KG_TEST_STARTUP_IMPORT_DELAY_MS;
    delete process.env.KG_SESSION_REAP_MS;
    await shutdownDaemon(daemonUrl);
    try {
      rmSync(project.projectDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup errors.
    }
  }

  console.error('═'.repeat(50));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
