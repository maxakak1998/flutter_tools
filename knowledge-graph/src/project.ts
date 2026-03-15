import { join, dirname, basename, resolve } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { log } from './types.js';

// ============================================================
// Types
// ============================================================

export interface ProjectConfig {
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

export interface ProjectInfo {
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

export interface RegistryEntry {
  name: string;
  path: string;
  registered_at: string;
  last_accessed: string;
}

interface Registry {
  version: number;
  projects: Record<string, RegistryEntry>;
}

// ============================================================
// Paths
// ============================================================

const KG_DIR_NAME = '.knowledge-graph';
const REGISTRY_PATH = join(homedir(), '.knowledge-graph', 'registry.json');

// ============================================================
// Project discovery — check CWD for .knowledge-graph/config.json
// ============================================================

export function discoverProject(startDir: string): ProjectInfo | null {
  const dir = resolve(startDir);
  const configPath = join(dir, KG_DIR_NAME, 'config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as ProjectConfig;
      const kgDir = join(dir, KG_DIR_NAME);
      log(`Discovered project "${config.project_name}" at ${dir}`);
      return {
        projectId: config.project_id,
        projectName: config.project_name,
        projectDir: dir,
        kgDir,
        dbPath: join(kgDir, 'data', 'knowledge'),
        configPath,
        daemonPortFile: join(kgDir, 'daemon.port'),
        daemonPidFile: join(kgDir, 'daemon.pid'),
        config,
      };
    } catch (e) {
      log(`Warning: could not parse ${configPath}:`, e);
      return null;
    }
  }
  return null;
}

// ============================================================
// kg init — create .knowledge-graph/ in a directory
// ============================================================

export function initProject(targetDir: string, name?: string, force?: boolean): ProjectInfo {
  const kgDir = join(targetDir, KG_DIR_NAME);
  const configPath = join(kgDir, 'config.json');

  if (existsSync(configPath)) {
    const existing = discoverProject(targetDir);
    if (existing && existing.projectDir === resolve(targetDir)) {
      throw new Error(`Already initialized: ${configPath}`);
    }
  }

  // Check if a parent directory already has a .knowledge-graph/ project
  if (!force) {
    let checkDir = resolve(dirname(resolve(targetDir)));
    while (true) {
      const parentConfig = join(checkDir, KG_DIR_NAME, 'config.json');
      if (existsSync(parentConfig)) {
        try {
          const parentCfg = JSON.parse(readFileSync(parentConfig, 'utf-8')) as ProjectConfig;
          throw new Error(
            `A parent directory already has a knowledge-graph project:\n` +
            `  Parent: ${checkDir} (project: "${parentCfg.project_name}")\n` +
            `  Target: ${resolve(targetDir)}\n` +
            `Creating a nested .knowledge-graph/ will shadow the parent and cause data confusion.\n` +
            `Use --force to override, or run commands from the parent project directory.`
          );
        } catch (e) {
          if (e instanceof Error && e.message.includes('parent directory already has')) throw e;
          // Could not parse parent config, continue checking
        }
      }
      const parent = dirname(checkDir);
      if (parent === checkDir) break;
      checkDir = parent;
    }
  }

  const projectId = randomUUID();
  const projectName = name || basename(targetDir);

  mkdirSync(join(kgDir, 'data'), { recursive: true });

  const config: ProjectConfig = {
    version: 1,
    project_id: projectId,
    project_name: projectName,
    created_at: new Date().toISOString(),
    daemon: {
      port_range_start: 0,
      idle_timeout_ms: 300_000,
    },
    overrides: {},
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Register in global registry
  registerProject(projectId, projectName, targetDir);

  // Append to .gitignore if .git exists
  const gitignorePath = join(targetDir, '.gitignore');
  const gitDir = join(targetDir, '.git');
  if (existsSync(gitDir)) {
    const ignoreLines = '.knowledge-graph/data/\n.knowledge-graph/daemon.*\n';
    if (existsSync(gitignorePath)) {
      const existing = readFileSync(gitignorePath, 'utf-8');
      if (!existing.includes('.knowledge-graph/data/')) {
        writeFileSync(gitignorePath, existing.trimEnd() + '\n' + ignoreLines);
      }
    } else {
      writeFileSync(gitignorePath, ignoreLines);
    }
  }

  return {
    projectId,
    projectName,
    projectDir: resolve(targetDir),
    kgDir,
    dbPath: join(kgDir, 'data', 'knowledge'),
    configPath,
    daemonPortFile: join(kgDir, 'daemon.port'),
    daemonPidFile: join(kgDir, 'daemon.pid'),
    config,
  };
}

// ============================================================
// Registry — global list of known projects
// ============================================================

function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) {
    return { version: 1, projects: {} };
  }
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as Registry;
  } catch {
    return { version: 1, projects: {} };
  }
}

function saveRegistry(registry: Registry): void {
  const dir = dirname(REGISTRY_PATH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

export function registerProject(projectId: string, name: string, path: string): void {
  const registry = loadRegistry();
  registry.projects[projectId] = {
    name,
    path: resolve(path),
    registered_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
  };
  saveRegistry(registry);
}

export function updateLastAccessed(projectId: string): void {
  const registry = loadRegistry();
  if (registry.projects[projectId]) {
    registry.projects[projectId].last_accessed = new Date().toISOString();
    saveRegistry(registry);
  }
}

export function listProjects(): Array<{ id: string } & RegistryEntry> {
  const registry = loadRegistry();
  return Object.entries(registry.projects).map(([id, entry]) => ({ id, ...entry }));
}

export function resolveProjectById(projectId: string): ProjectInfo | null {
  const registry = loadRegistry();
  const entry = registry.projects[projectId];
  if (!entry) return null;
  return discoverProject(entry.path);
}
