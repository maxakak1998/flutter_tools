#!/usr/bin/env npx tsx

/**
 * Self-heal test for the MCP client (Fix 1).
 *
 * Proves: when the daemon dies mid-session, the client's callWithRevive wrapper
 * respawns it via ensureDaemon() + re-registers the session, and the retried RPC
 * succeeds — no manual reconnect. Also proves a well-formed JSON-RPC error does
 * NOT trigger a revive.
 *
 * IMPORTANT: runs against built dist/ files (daemon-manager forks daemon.js).
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ensureDaemon } from '../dist/daemon-manager.js';
import { loadConfig } from '../dist/config.js';
import { rpcCall, callWithRevive, DaemonUnreachableError } from '../dist/client.js';

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

function createTestProject(): any {
  const projectDir = mkdtempSync(join(tmpdir(), 'kg-self-heal-'));
  const kgDir = join(projectDir, '.knowledge-graph');
  mkdirSync(join(kgDir, 'data'), { recursive: true });

  const config = {
    version: 1,
    project_id: randomUUID(),
    project_name: 'self-heal-test',
    created_at: new Date().toISOString(),
    daemon: { port_range_start: 0, idle_timeout_ms: 60_000 },
    overrides: {},
  };
  writeFileSync(join(kgDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');

  return {
    projectId: config.project_id,
    projectName: config.project_name,
    projectDir,
    kgDir,
    dbPath: join(kgDir, 'data', 'knowledge'),
    configPath: join(kgDir, 'config.json'),
    daemonPortFile: join(kgDir, 'daemon.port'),
    daemonPidFile: join(kgDir, 'daemon.pid'),
    config,
  };
}

async function getHealth(baseUrl: string): Promise<any | null> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function waitFor(pred: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function main() {
  console.error('🧪 Self-Heal Test (MCP client Fix 1)');
  console.error('═'.repeat(50));

  const project = createTestProject();
  const config = loadConfig();
  let daemonUrl: string | null = null;

  try {
    // ── Simulate the client's own state: mutable url + connect + revive ──
    const sessionId = randomUUID();
    daemonUrl = await ensureDaemon(project, config);

    async function connectSession(): Promise<void> {
      await fetch(`${daemonUrl}/rpc/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => {});
    }
    async function reviveDaemon(): Promise<void> {
      daemonUrl = await ensureDaemon(project, config);
      await connectSession();
    }
    const callRpc = (method: string, params: unknown) =>
      callWithRevive(() => rpcCall(daemonUrl!, method, params), reviveDaemon);

    await connectSession();

    console.error('\n📋 Test 1: RPC works while daemon is alive');
    const list1 = await callRpc('knowledge_list', { limit: 1 });
    assert(list1 !== undefined && list1 !== null, 'knowledge_list returns a result', JSON.stringify(list1)?.slice(0, 80));

    console.error('\n📋 Test 2: kill daemon, next RPC self-heals');
    const deadUrl = daemonUrl;
    await fetch(`${daemonUrl}/rpc/shutdown`, { method: 'POST' }).catch(() => {});
    const stopped = await waitFor(async () => (await getHealth(deadUrl!)) === null, 10_000);
    assert(stopped, 'Daemon confirmed dead before retry');

    // This RPC would throw "fetch failed" without self-heal; instead it revives.
    const list2 = await callRpc('knowledge_list', { limit: 1 });
    assert(list2 !== undefined && list2 !== null, 'RPC succeeds after daemon death (self-healed)', JSON.stringify(list2)?.slice(0, 80));
    assert(daemonUrl !== deadUrl, 'daemonUrl repointed to a fresh daemon', `old=${deadUrl} new=${daemonUrl}`);

    console.error('\n📋 Test 3: revived daemon has our session registered (no idle-die)');
    const health = await getHealth(daemonUrl!);
    assert((health?.clients ?? 0) >= 1, 'Revived daemon counts >=1 client', `clients=${health?.clients}`);

    console.error('\n📋 Test 4: real JSON-RPC error does NOT trigger revive');
    // A daemon-side error (unknown method) is a well-formed JSON-RPC error, not a
    // transport failure — it must surface as-is, never a revive loop.
    let reviveCalled = false;
    const noRevive = async () => { reviveCalled = true; };
    let threw = false;
    try {
      await callWithRevive(
        () => rpcCall(daemonUrl!, 'no_such_method_xyz', {}),
        noRevive,
      );
    } catch {
      threw = true;
    }
    assert(threw, 'JSON-RPC error propagates (throws)');
    assert(!reviveCalled, 'JSON-RPC error did NOT trigger revive');

    console.error('\n📋 Test 5: DaemonUnreachableError raised on dead url');
    let unreachable = false;
    try {
      await rpcCall('http://127.0.0.1:1/rpc'.replace('/rpc', ''), 'knowledge_list', {});
    } catch (e) {
      unreachable = e instanceof DaemonUnreachableError;
    }
    assert(unreachable, 'rpcCall throws DaemonUnreachableError when transport fails');
  } catch (e) {
    console.error(`\n💥 FATAL: ${e}`);
    if (e instanceof Error) console.error(e.stack);
    failed++;
  } finally {
    if (daemonUrl) await fetch(`${daemonUrl}/rpc/shutdown`, { method: 'POST' }).catch(() => {});
    try { rmSync(project.projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.error('═'.repeat(50));
  console.error(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
