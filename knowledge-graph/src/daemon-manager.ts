import { fork } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { ProjectInfo } from './project.js';
import { KnowledgeConfig } from './config.js';
import { log } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    const port = parseInt(readFileSync(project.daemonPortFile, 'utf-8').trim(), 10);
    if (port > 0) {
      const url = `http://127.0.0.1:${port}`;
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
        const health = await res.json() as { status: string; project_id: string };
        if (health.status === 'ok' && health.project_id === project.projectId) {
          log(`Connected to existing daemon on port ${port}`);
          return url;
        }
      } catch {
        // Daemon is dead or wrong project, clean up
        log('Stale daemon files found, cleaning up');
        cleanupDaemonFiles(project);
      }
    }
  }

  // 2. Check PID file for zombie process
  if (existsSync(project.daemonPidFile)) {
    const pid = parseInt(readFileSync(project.daemonPidFile, 'utf-8').trim(), 10);
    if (pid > 0 && !isProcessAlive(pid)) {
      cleanupDaemonFiles(project);
    }
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
      },
    });

    child.unref();

    // Poll for daemon.port file
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error('Daemon startup timed out after 15s'));
    }, 15_000);

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
