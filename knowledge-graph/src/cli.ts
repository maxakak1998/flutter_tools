#!/usr/bin/env node

import { join, dirname } from 'path';
import { homedir } from 'os';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  accessSync,
  constants,
} from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { discoverProject, initProject, listProjects, updateLastAccessed, type ProjectInfo } from './project.js';
import { ensureDaemon } from './daemon-manager.js';
import { getRuntimeVersion } from './version.js';
import {
  loadConfig,
  applyOverrides,
  saveDefaultConfig,
  CONFIG_PATH,
  ConfigOverrides,
  KnowledgeConfig,
} from './config.js';
import { log } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Argument parsing (no extra dependencies)
// ============================================================

const rawArgs = process.argv.slice(2);

interface ParsedArgs {
  command: string;
  port?: number;
  storageBackend?: string;
  dbPath?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  keepData: boolean;
  force: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(): ParsedArgs {
  let command = '';
  let port: number | undefined;
  let storageBackend: string | undefined;
  let dbPath: string | undefined;
  let ollamaUrl: string | undefined;
  let ollamaModel: string | undefined;
  let keepData = false;
  let force = false;
  let help = false;
  let version = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--storage':
        storageBackend = rawArgs[++i];
        break;
      case '--db-path':
        dbPath = rawArgs[++i];
        break;
      case '--ollama-url':
        ollamaUrl = rawArgs[++i];
        break;
      case '--ollama-model':
        ollamaModel = rawArgs[++i];
        break;
      case '--keep-data':
        keepData = true;
        break;
      case '--force':
      case '-f':
        force = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--version':
      case '-v':
        version = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          // Parse serve:PORT syntax
          if (arg.includes(':')) {
            const [cmd, portStr] = arg.split(':');
            command = cmd;
            const parsedPort = parseInt(portStr, 10);
            if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
              port = parsedPort;
            } else {
              console.error(`Error: Invalid port number "${portStr}". Must be between 1 and 65535.`);
              process.exit(1);
            }
          } else {
            command = arg;
          }
        }
        break;
    }
  }

  return { command, port, storageBackend, dbPath, ollamaUrl, ollamaModel, keepData, force, help, version };
}

// ============================================================
// Help text
// ============================================================

function printHelp(): void {
  console.log(`
knowledge-graph - Semantic knowledge base MCP server

USAGE
  knowledge-graph [command] [options]

COMMANDS
  serve[:PORT]       Start MCP server (auto-detects project, uses daemon)
                     Optionally specify port, kills existing process if needed
  stop               Stop the running daemon for the current project
  init [--force]     Initialize .knowledge-graph/ in current directory
  serve-standalone   Start daemon + dashboard (no MCP, standalone mode)
  setup              Write config + MCP settings
  doctor             Check dependencies (Ollama, DB, Node, daemon)
  reset-db           Delete the database (all chunks, edges, embeddings)
  uninstall          Remove installed files, config, and MCP registration

OPTIONS
  --storage <backend>   Storage backend: kuzu or surreal (default: kuzu)
  --db-path <path>      Override database path
  --ollama-url <url>    Ollama API endpoint
  --ollama-model <name> Embedding model name
  --keep-data           Keep database on uninstall
  --force, -f           Force init even if parent has .knowledge-graph/
  -h, --help            Show this help
  -v, --version         Show version

CONFIG FILE
  ~/.knowledge-graph/knowledge.json

  All settings can be changed in this file. CLI flags and env vars
  override config file values. Run 'knowledge-graph setup' to create
  a default config.

  Priority: CLI flags > env vars > knowledge.json > defaults

ENVIRONMENT VARIABLES
  KNOWLEDGE_STORAGE_BACKEND  Storage backend (kuzu or surreal)
  KNOWLEDGE_DB_PATH          Database directory path
  OLLAMA_URL                 Ollama API endpoint
  OLLAMA_MODEL               Embedding model name

EXAMPLES
  knowledge-graph                         # Show help text
  knowledge-graph serve                    # Start with auto-detected project
  knowledge-graph serve:5000              # Start server on port 5000 (kill if in use)
  knowledge-graph setup                   # Create config + register MCP
  knowledge-graph doctor                  # Verify dependencies
  knowledge-graph reset-db                # Wipe database, keep config
  knowledge-graph uninstall               # Remove everything
  knowledge-graph uninstall --keep-data   # Remove but keep database
`);
}

// ============================================================
// Version
// ============================================================

function printVersion(): void {
  console.log(`knowledge-graph v${getRuntimeVersion()}`);
}

// ============================================================
// Resolve config: load file → apply env vars → apply CLI flags
// ============================================================

function resolveConfig(parsed: ParsedArgs): KnowledgeConfig {
  // 1. Load from knowledge.json (merged with defaults)
  const fileConfig = loadConfig();

  // 2. Build overrides: CLI flags win over env vars
  const storageEnv = parsed.storageBackend || process.env.KNOWLEDGE_STORAGE_BACKEND || undefined;
  if (storageEnv && storageEnv !== 'kuzu' && storageEnv !== 'surreal') {
    console.error(`Error: Unknown storage backend "${storageEnv}". Valid options: kuzu, surreal`);
    process.exit(1);
  }
  const overrides: ConfigOverrides = {
    storageBackend: storageEnv as ConfigOverrides['storageBackend'],
    dbPath: parsed.dbPath || process.env.KNOWLEDGE_DB_PATH || undefined,
    ollamaUrl: parsed.ollamaUrl || process.env.OLLAMA_URL || undefined,
    ollamaModel: parsed.ollamaModel || process.env.OLLAMA_MODEL || undefined,
  };

  // 3. Apply overrides on top of file config
  return applyOverrides(fileConfig, overrides);
}

// ============================================================
// Setup command
// ============================================================

async function runSetup(parsed: ParsedArgs): Promise<void> {
  const config = resolveConfig(parsed);

  // 1. Create default knowledge.json if missing
  const configPath = saveDefaultConfig();
  console.log(`Config: ${configPath}`);

  // 2. Ensure data directory exists
  const dataDir = join(config.db.path, '..');
  mkdirSync(dataDir, { recursive: true });

  // 3. Print instructions for project-level .mcp.json setup
  const cliPath = join(__dirname, 'cli.js');
  const mcpConfig = {
    mcpServers: {
      'knowledge-graph': {
        command: 'node',
        args: [cliPath, 'serve'],
      },
    },
  };

  console.log(`  DB path: ${config.db.path}`);
  console.log(`  Ollama: ${config.ollama.url} (model: ${config.ollama.model})`);
  console.log(`\nTo enable MCP in Claude Code, add .mcp.json to your project root:`);
  console.log(JSON.stringify(mcpConfig, null, 2));
  console.log(`\nEdit ~/.knowledge-graph/knowledge.json to change settings.`);
  console.log('Restart Claude Code to pick up the new MCP server.');
}

// ============================================================
// Doctor command
// ============================================================

async function runDoctor(parsed: ParsedArgs): Promise<void> {
  const config = resolveConfig(parsed);
  // Use project-local DB path if in a project directory
  const project = discoverProject(process.cwd());
  if (project) {
    config.db.path = project.dbPath;
  }
  const checks: { name: string; status: 'ok' | 'warn' | 'fail'; detail: string }[] = [];

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major >= 18) {
    checks.push({ name: 'Node.js', status: 'ok', detail: `v${nodeVersion}` });
  } else {
    checks.push({ name: 'Node.js', status: 'fail', detail: `v${nodeVersion} (need >= 18)` });
  }

  // 2. Config file
  if (existsSync(CONFIG_PATH)) {
    checks.push({ name: 'Config file', status: 'ok', detail: CONFIG_PATH });
  } else {
    checks.push({ name: 'Config file', status: 'warn', detail: `not found — run: knowledge-graph setup` });
  }

  // 3. Ollama running
  try {
    const res = await fetch(`${config.ollama.url}/api/tags`);
    if (res.ok) {
      const data = (await res.json()) as { models?: { name: string }[] };
      checks.push({ name: 'Ollama', status: 'ok', detail: config.ollama.url });

      // 4. Model available
      const models = data.models || [];
      const hasModel = models.some((m) => m.name.startsWith(config.ollama.model));
      if (hasModel) {
        checks.push({ name: `${config.ollama.model} model`, status: 'ok', detail: 'installed' });
      } else {
        checks.push({
          name: `${config.ollama.model} model`,
          status: 'fail',
          detail: `not found — run: ollama pull ${config.ollama.model}`,
        });
      }
    } else {
      checks.push({ name: 'Ollama', status: 'fail', detail: `HTTP ${res.status}` });
      checks.push({ name: `${config.ollama.model} model`, status: 'fail', detail: 'Ollama not available' });
    }
  } catch {
    checks.push({ name: 'Ollama', status: 'fail', detail: `not reachable at ${config.ollama.url}` });
    checks.push({ name: `${config.ollama.model} model`, status: 'fail', detail: 'Ollama not available' });
  }

  // 5. DB path writable
  const dbParent = join(config.db.path, '..');
  try {
    mkdirSync(dbParent, { recursive: true });
    accessSync(dbParent, constants.W_OK);
    checks.push({ name: 'DB path', status: 'ok', detail: config.db.path });
  } catch {
    checks.push({ name: 'DB path', status: 'fail', detail: `not writable: ${config.db.path}` });
  }

  // Print results
  console.log('\nknowledge-graph doctor\n');
  if (project) {
    console.log(`  Project: ${project.projectName}\n`);
  }
  const statusIcon = { ok: '\u2713', warn: '!', fail: '\u2717' };
  const statusColor = { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' };
  const reset = '\x1b[0m';

  for (const check of checks) {
    const icon = statusIcon[check.status];
    const color = statusColor[check.status];
    console.log(`  ${color}${icon}${reset} ${check.name}: ${check.detail}`);
  }

  const failures = checks.filter((c) => c.status === 'fail');
  if (failures.length > 0) {
    console.log(`\n${failures.length} issue(s) found. Fix them before starting the server.`);
    process.exit(1);
  } else {
    console.log('\nAll checks passed!');
  }
}

// ============================================================
// Reset DB command
// ============================================================

async function runResetDb(parsed: ParsedArgs): Promise<void> {
  // Use project-local DB if in a project directory, else fall back to global
  const project = discoverProject(process.cwd());
  let dbPath: string;
  if (project) {
    dbPath = project.dbPath;
  } else {
    const config = resolveConfig(parsed);
    dbPath = config.db.path;
  }

  console.log('\nknowledge-graph reset-db\n');
  if (project) {
    console.log(`  Project:  ${project.projectName}`);
  }
  console.log(`  Database: ${dbPath}`);

  // Stop daemon / servers that hold the DB lock
  if (project) {
    await stopProjectDaemon(project);
  }
  killExistingServers(dbPath);

  // Remove DB file and WAL
  const walPath = dbPath + '.wal';
  const { rmSync } = await import('fs');
  let removed = false;

  if (existsSync(dbPath)) {
    rmSync(dbPath, { recursive: true, force: true });
    console.log(`  Removed ${dbPath}`);
    removed = true;
  }
  if (existsSync(walPath)) {
    rmSync(walPath, { recursive: true, force: true });
    console.log(`  Removed ${walPath}`);
    removed = true;
  }

  if (removed) {
    console.log('\nDatabase deleted. A fresh DB will be created on next serve.\n');
  } else {
    console.log('\nNo database found. Nothing to delete.\n');
  }
}

// ============================================================
// Uninstall command
// ============================================================

async function runUninstall(parsed: ParsedArgs): Promise<void> {
  const kgHome = join(homedir(), '.knowledge-graph');

  console.log('\nknowledge-graph uninstall\n');

  // 1. Remove MCP config from ~/.claude/settings.json
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.mcpServers?.['knowledge-graph']) {
        delete settings.mcpServers['knowledge-graph'];
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log('  Removed MCP config from ~/.claude/settings.json');
      }
    } catch {
      console.error('  Warning: Could not update ~/.claude/settings.json');
    }
  }

  // 2. Remove symlink from PATH
  const symlinkPaths = [
    '/usr/local/bin/knowledge-graph',
    '/usr/local/bin/kg',
    '/usr/local/bin/kp',
    join(homedir(), '.local', 'bin', 'knowledge-graph'),
    join(homedir(), '.local', 'bin', 'kg'),
  ];
  for (const linkPath of symlinkPaths) {
    if (existsSync(linkPath)) {
      try {
        const { unlinkSync } = await import('fs');
        unlinkSync(linkPath);
        console.log(`  Removed symlink ${linkPath}`);
      } catch {
        console.error(`  Warning: Could not remove ${linkPath} (try with sudo)`);
      }
    }
  }

  // 3. Remove installed source
  const srcDir = join(kgHome, 'src');
  if (existsSync(srcDir)) {
    const { rmSync } = await import('fs');
    rmSync(srcDir, { recursive: true, force: true });
    console.log('  Removed ~/.knowledge-graph/src/');
  }

  // 4. Remove data (unless --keep-data)
  if (parsed.keepData) {
    console.log('  Kept database at ~/.knowledge-graph/data/ (--keep-data)');
    // Remove config but keep data
    const configFile = join(kgHome, 'knowledge.json');
    if (existsSync(configFile)) {
      const { unlinkSync } = await import('fs');
      unlinkSync(configFile);
      console.log('  Removed ~/.knowledge-graph/knowledge.json');
    }
  } else {
    if (existsSync(kgHome)) {
      const { rmSync } = await import('fs');
      rmSync(kgHome, { recursive: true, force: true });
      console.log('  Removed ~/.knowledge-graph/ (config + database)');
    }
  }

  console.log('\nUninstall complete. Restart Claude Code to remove the MCP server.\n');
}

// ============================================================
// Kill process on specific port
// ============================================================

function killProcessOnPort(port: number): void {
  try {
    // Find process using the port
    const lsofResult = execSync(
      `lsof -i :${port} 2>/dev/null | grep LISTEN | awk '{print $2}' | head -1 || true`,
      { encoding: 'utf-8', timeout: 3000 },
    ).trim();

    if (!lsofResult) {
      log(`Port ${port} is available`);
      return;
    }

    const pid = parseInt(lsofResult, 10);
    if (!pid || pid === process.pid) {
      return;
    }

    try {
      // Get process info before killing
      const cmdline = execSync(`ps -p ${pid} -o comm=,args= 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();

      log(`Killing existing process on port ${port} (PID: ${pid})`);
      process.kill(pid, 'SIGTERM');

      // Wait for process to terminate
      let attempts = 0;
      while (attempts < 10) {
        try {
          process.kill(pid, 0); // Check if process still exists
          execSync('sleep 0.1');
          attempts++;
        } catch {
          // Process no longer exists
          break;
        }
      }

      // Force kill if still alive
      try {
        process.kill(pid, 0);
        log(`Force killing PID ${pid}`);
        process.kill(pid, 'SIGKILL');
        execSync('sleep 0.2');
      } catch {
        // Already dead
      }
    } catch {
      // Failed to get process info or kill, continue anyway
    }
  } catch {
    // lsof not available or port not in use, continue
  }
}

// ============================================================
// Kill existing servers (prevent KuzuDB lock conflicts)
// ============================================================

function killExistingServers(dbPath: string): void {
  try {
    const currentPid = process.pid;

    // Find knowledge-graph serve processes by command line
    const psResult = execSync(
      `ps aux | grep -E 'cli\\.js\\s+serve' | grep -v grep | awk '{print $2}' 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 3000 },
    ).trim();

    const allPids = new Set<number>();
    for (const raw of psResult.split('\n')) {
      const pid = parseInt(raw.trim(), 10);
      if (pid && pid !== currentPid) allPids.add(pid);
    }

    if (allPids.size === 0) return;

    for (const pid of allPids) {
      try {
        // Verify it's a node process running our CLI before killing
        const cmdline = execSync(`ps -p ${pid} -o comm=,args= 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        // Only kill node processes running cli.js serve
        if (cmdline.startsWith('node') && cmdline.includes('cli.js') && cmdline.includes('serve')) {
          log(`Killing existing server process ${pid} (${cmdline.split(/\s+/).slice(0, 4).join(' ')})`);
          process.kill(pid, 'SIGTERM');
        }
      } catch {
        // Process may have already exited
      }
    }

    // Brief wait for lock release
    execSync('sleep 0.5');
  } catch {
    // Non-fatal — if we can't kill, the DB open will fail with a clear error anyway
  }
}

// ============================================================
// Serve command
// ============================================================

async function runServe(parsed: ParsedArgs): Promise<void> {
  const project = discoverProject(process.cwd());

  if (!project) {
    log('No .knowledge-graph/ found. Run `knowledge-graph init` first to initialize this project.');
    process.exit(1);
  }

  // Project mode — daemon + client
  log(`Project: ${project.projectName} (${project.projectId.slice(0, 8)}...)`);
  updateLastAccessed(project.projectId);

  const config = resolveConfig(parsed);
  // Override DB path to project-local
  config.db.path = project.dbPath;

  // Kill and restart if port specified
  if (parsed.port) {
    killProcessOnPort(parsed.port);
  }

  const daemonUrl = await ensureDaemon(project, config, parsed.port);

  const { clientMain } = await import('./client.js');
  await clientMain(daemonUrl, project.projectId);
}

// ============================================================
// Init command
// ============================================================

async function runInit(parsed: ParsedArgs): Promise<void> {
  const targetDir = process.cwd();
  try {
    const project = initProject(targetDir, undefined, parsed.force);
    console.log(`\nInitialized knowledge-graph for "${project.projectName}"\n`);
    console.log(`  Project ID: ${project.projectId}`);
    console.log(`  Config:     ${project.configPath}`);
    console.log(`  Database:   ${project.dbPath}`);
    console.log(`\nRun 'kg serve' or restart Claude Code to start using it.\n`);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ============================================================
// Serve-standalone command (dashboard without MCP)
// ============================================================

async function runServeStandalone(parsed: ParsedArgs): Promise<void> {
  // Find project: from CWD or list all
  let project = discoverProject(process.cwd());

  if (!project) {
    const projects = listProjects();
    if (projects.length === 0) {
      console.error('No projects found. Run "kg init" in a project directory first.');
      process.exit(1);
    }
    console.log('\nKnown projects:\n');
    projects.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} (${p.path})`);
    });
    console.log(`\nRun "kg serve-standalone" from inside a project directory.`);
    process.exit(0);
  }

  console.log(`\nProject: ${project.projectName}`);
  updateLastAccessed(project.projectId);

  const config = resolveConfig(parsed);
  config.db.path = project.dbPath;

  const daemonUrl = await ensureDaemon(project, config);
  console.log(`Dashboard: ${daemonUrl}`);
  console.log('Press Ctrl+C to stop.\n');

  // Keep alive
  await new Promise(() => {});
}

// ============================================================
// Daemon shutdown helper (used by stop + reset-db)
// ============================================================

async function stopProjectDaemon(project: ProjectInfo): Promise<boolean> {
  const portFile = project.daemonPortFile;
  const pidFile = project.daemonPidFile;

  if (!existsSync(portFile) && !existsSync(pidFile)) {
    return false;
  }

  let stopped = false;

  // Try graceful shutdown via HTTP first
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, 'utf-8').trim();
    const daemonUrl = `http://127.0.0.1:${port}`;
    try {
      const res = await fetch(`${daemonUrl}/rpc/shutdown`, { method: 'POST' });
      if (res.ok) {
        console.log(`  Daemon stopped (was on port ${port})`);
        await new Promise((r) => setTimeout(r, 300));
        stopped = true;
      }
    } catch {
      // HTTP failed — fall through to PID kill
    }
  }

  // Fallback: kill by PID
  if (!stopped && existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`  Daemon stopped (killed PID ${pid})`);
        stopped = true;
      } catch {
        // Process already dead
      }
    }
  }

  // Clean up stale files
  const { unlinkSync: unlink } = await import('fs');
  try { if (existsSync(portFile)) unlink(portFile); } catch { /* ignore */ }
  try { if (existsSync(pidFile)) unlink(pidFile); } catch { /* ignore */ }

  return stopped;
}

// ============================================================
// Stop command
// ============================================================

async function runStop(): Promise<void> {
  const project = discoverProject(process.cwd());

  if (!project) {
    console.error('No .knowledge-graph/ found in current directory or parents.');
    console.error('Run this command from inside a project with knowledge-graph initialized.');
    process.exit(1);
  }

  const stopped = await stopProjectDaemon(project);
  if (!stopped) {
    console.log('No daemon running for this project.');
    process.exit(0);
  }
}

// ============================================================
// Main dispatcher
// ============================================================

const parsed = parseArgs();

if (parsed.help) {
  printHelp();
  process.exit(0);
}

if (parsed.version) {
  printVersion();
  process.exit(0);
}

switch (parsed.command) {
  case 'serve':
    runServe(parsed).catch((e) => {
      console.error('Fatal error:', e);
      process.exit(1);
    });
    break;

  case 'stop':
    runStop().catch((e) => {
      console.error('Stop failed:', e);
      process.exit(1);
    });
    break;

  case 'init':
    runInit(parsed).catch((e) => {
      console.error('Init failed:', e);
      process.exit(1);
    });
    break;

  case 'serve-standalone':
    runServeStandalone(parsed).catch((e) => {
      console.error('Serve-standalone failed:', e);
      process.exit(1);
    });
    break;

  case 'setup':
    runSetup(parsed).catch((e) => {
      console.error('Setup failed:', e);
      process.exit(1);
    });
    break;

  case 'doctor':
    runDoctor(parsed).catch((e) => {
      console.error('Doctor failed:', e);
      process.exit(1);
    });
    break;

  case 'reset-db':
    runResetDb(parsed).catch((e) => {
      console.error('Reset DB failed:', e);
      process.exit(1);
    });
    break;

  case 'uninstall':
    runUninstall(parsed).catch((e) => {
      console.error('Uninstall failed:', e);
      process.exit(1);
    });
    break;

  case '':
    printHelp();
    process.exit(0);

  default:
    console.error(`Unknown command: ${parsed.command}`);
    printHelp();
    process.exit(1);
}
