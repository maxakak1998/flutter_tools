import { fork } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { ProjectInfo } from './project.js';
import { KnowledgeConfig, CONFIG_PATH } from './config.js';
import { log, DAEMON_STARTUP_TIMEOUT_MESSAGE } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The daemon writes daemon.port from its listen() callback. Its startup sync import
// runs after listen, so this only has to cover DB open + migrations.
const STARTUP_TIMEOUT_MS = 15_000;
// Max wait for a daemon that reported status 'shutting_down' to release the DB lock.
const SHUTDOWN_WAIT_MS = 15_000;

/**
 * Ensure a daemon is running for the given project.
 * Returns the daemon's base URL (e.g., "http://127.0.0.1:54321").
 * If port is specified, override the configured port range start.
 */
export async function ensureDaemon(
  project: ProjectInfo,
  config: KnowledgeConfig,
  port?: number,
): Promise<string> {
  // 1. Check for existing daemon via port file
  if (existsSync(project.daemonPortFile)) {
    const port = readIntFile(project.daemonPortFile);
    if (port > 0) {
      const url = `http://127.0.0.1:${port}`;
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
        const health = await res.json() as { status: string; project_id: string };
        if (health.status === 'ok' && health.project_id === project.projectId) {
          log(`Connected to existing daemon on port ${port}`);
          return url;
        }
        if (health.status === 'shutting_down' && health.project_id === project.projectId) {
          // Adopting it would hand back a URL that dies in a moment; spawning now would
          // fail on the DB lock it still holds (and resolve on its stale daemon.port).
          // Wait for it to exit, then fall through to spawn a fresh one.
          log(`Daemon on port ${port} is shutting down — waiting for it to exit`);
          await waitForDaemonExit(project);
        }
      } catch {
        // Daemon is dead or wrong project, clean up
        log('Stale daemon files found, cleaning up');
        cleanupDaemonFiles(project);
      }
    }
  }

  // 2. Check PID file for zombie process
  const pid = readIntFile(project.daemonPidFile);
  if (pid > 0 && !isProcessAlive(pid)) {
    cleanupDaemonFiles(project);
  }

  // 3. Spawn new daemon
  return spawnDaemon(project, config, port);
}

function spawnDaemon(project: ProjectInfo, config: KnowledgeConfig, port?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const daemonScript = join(__dirname, 'daemon.js');

    // Override DB path to project-local
    const daemonConfig: KnowledgeConfig = {
      ...config,
      db: { path: project.dbPath },
    };

    // Determine port to use: explicit port > project config > default
    const portToUse = port ?? project.config.daemon.port_range_start;

    const child = fork(daemonScript, [], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        KG_DAEMON_CONFIG: JSON.stringify(daemonConfig),
        KG_PROJECT_DIR: project.kgDir,
        KG_PROJECT_ID: project.projectId,
        KG_IDLE_TIMEOUT_MS: String(project.config.daemon.idle_timeout_ms),
        KG_PORT_RANGE_START: String(portToUse),
        KG_CONFIG_PATH: CONFIG_PATH,
      },
    });

    child.unref();

    // Poll for daemon.port file
    const timeout = setTimeout(() => {
      clearInterval(interval);
      const logFile = join(project.kgDir, 'logs', 'daemon.log');
      const hint = existsSync(logFile) ? '\nCheck logs: kg logs' : '';
      reject(new Error(`${DAEMON_STARTUP_TIMEOUT_MESSAGE} after ${STARTUP_TIMEOUT_MS / 1000}s${hint}`));
    }, STARTUP_TIMEOUT_MS);

    const interval = setInterval(() => {
      if (existsSync(project.daemonPortFile)) {
        clearInterval(interval);
        clearTimeout(timeout);
        const port = parseInt(readFileSync(project.daemonPortFile, 'utf-8').trim(), 10);
        log(`Daemon spawned on port ${port}`);
        resolve(`http://127.0.0.1:${port}`);
      }
    }, 100);
  });
}

/**
 * Poll until the daemon's pid is gone (it removes its own port/pid files on exit),
 * bounded by SHUTDOWN_WAIT_MS. Leftover files of a dead pid are cleaned so the
 * subsequent spawn cannot resolve on a stale daemon.port.
 */
async function waitForDaemonExit(project: ProjectInfo): Promise<void> {
  const deadline = Date.now() + SHUTDOWN_WAIT_MS;
  while (Date.now() < deadline) {
    const pid = readIntFile(project.daemonPidFile);
    if (!(pid > 0) || !isProcessAlive(pid)) {
      cleanupDaemonFiles(project);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  log('Daemon still shutting down after wait; attempting spawn anyway');
}

/** daemon.port/daemon.pid as a number, 0 when absent/unreadable (an exiting daemon deletes them). */
function readIntFile(path: string): number {
  try {
    return parseInt(readFileSync(path, 'utf-8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function cleanupDaemonFiles(project: ProjectInfo): void {
  try { if (existsSync(project.daemonPortFile)) unlinkSync(project.daemonPortFile); } catch { /* ignore */ }
  try { if (existsSync(project.daemonPidFile)) unlinkSync(project.daemonPidFile); } catch { /* ignore */ }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
