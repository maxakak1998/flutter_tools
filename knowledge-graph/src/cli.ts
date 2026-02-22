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
import { createConnection } from 'net';
import { execSync } from 'child_process';
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
  dbPath?: string;
  port?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  noDashboard: boolean;
  keepData: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(): ParsedArgs {
  let command = '';
  let dbPath: string | undefined;
  let port: string | undefined;
  let ollamaUrl: string | undefined;
  let ollamaModel: string | undefined;
  let noDashboard = false;
  let keepData = false;
  let help = false;
  let version = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--db-path':
        dbPath = rawArgs[++i];
        break;
      case '--port':
        port = rawArgs[++i];
        break;
      case '--ollama-url':
        ollamaUrl = rawArgs[++i];
        break;
      case '--ollama-model':
        ollamaModel = rawArgs[++i];
        break;
      case '--no-dashboard':
        noDashboard = true;
        break;
      case '--keep-data':
        keepData = true;
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
          command = arg;
        }
        break;
    }
  }

  return { command, dbPath, port, ollamaUrl, ollamaModel, noDashboard, keepData, help, version };
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
  serve              Start MCP server (default)
  setup              Write config + MCP settings
  doctor             Check dependencies (Ollama, DB, Node)
  uninstall          Remove installed files, config, and MCP registration

OPTIONS
  --db-path <path>      Override database path
  --port <port>         Dashboard HTTP port
  --ollama-url <url>    Ollama API endpoint
  --ollama-model <name> Embedding model name
  --no-dashboard        Disable the HTTP dashboard
  -h, --help            Show this help
  -v, --version         Show version

CONFIG FILE
  ~/.knowledge-graph/knowledge.json

  All settings can be changed in this file. CLI flags and env vars
  override config file values. Run 'knowledge-graph setup' to create
  a default config.

  Priority: CLI flags > env vars > knowledge.json > defaults

ENVIRONMENT VARIABLES
  KNOWLEDGE_DB_PATH  Database directory path
  OLLAMA_URL         Ollama API endpoint
  OLLAMA_MODEL       Embedding model name
  DASHBOARD_PORT     Dashboard HTTP port
  NO_DASHBOARD       Set to "1" to disable dashboard

EXAMPLES
  knowledge-graph                         # Start with config file settings
  knowledge-graph serve --port 4000       # Override dashboard port
  knowledge-graph setup                   # Create config + register MCP
  knowledge-graph doctor                  # Verify dependencies
  knowledge-graph uninstall               # Remove everything
  knowledge-graph uninstall --keep-data   # Remove but keep database
`);
}

// ============================================================
// Version
// ============================================================

function printVersion(): void {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    console.log(`knowledge-graph v${pkg.version}`);
  } catch {
    console.log('knowledge-graph v1.0.0');
  }
}

// ============================================================
// Resolve config: load file → apply env vars → apply CLI flags
// ============================================================

function resolveConfig(parsed: ParsedArgs): KnowledgeConfig {
  // 1. Load from knowledge.json (merged with defaults)
  const fileConfig = loadConfig();

  // 2. Build overrides: CLI flags win over env vars
  const overrides: ConfigOverrides = {
    dbPath: parsed.dbPath || process.env.KNOWLEDGE_DB_PATH || undefined,
    ollamaUrl: parsed.ollamaUrl || process.env.OLLAMA_URL || undefined,
    ollamaModel: parsed.ollamaModel || process.env.OLLAMA_MODEL || undefined,
    dashboardPort: parsed.port
      ? parseInt(parsed.port, 10)
      : process.env.DASHBOARD_PORT
        ? parseInt(process.env.DASHBOARD_PORT, 10)
        : undefined,
    noDashboard: parsed.noDashboard || process.env.NO_DASHBOARD === '1' || undefined,
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

  // 3. Write MCP config to ~/.claude/settings.json
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const cliPath = join(__dirname, 'cli.js');

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.error(`Warning: Could not parse ${settingsPath}, creating fresh`);
    }
  } else {
    mkdirSync(join(homedir(), '.claude'), { recursive: true });
  }

  if (!settings.mcpServers || typeof settings.mcpServers !== 'object') {
    settings.mcpServers = {};
  }

  const mcpServers = settings.mcpServers as Record<string, unknown>;
  mcpServers['knowledge-graph'] = {
    command: 'node',
    args: [cliPath, 'serve'],
  };

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  console.log(`MCP config: ${settingsPath}`);
  console.log(`  Command: node ${cliPath} serve`);
  console.log(`  DB path: ${config.db.path}`);
  console.log(`  Ollama: ${config.ollama.url} (model: ${config.ollama.model})`);
  console.log(`  Dashboard: port ${config.dashboard.port} (${config.dashboard.enabled ? 'enabled' : 'disabled'})`);
  console.log(`\nEdit ~/.knowledge-graph/knowledge.json to change settings.`);
  console.log('Restart Claude Code to pick up the new MCP server.');
}

// ============================================================
// Doctor command
// ============================================================

async function runDoctor(parsed: ParsedArgs): Promise<void> {
  const config = resolveConfig(parsed);
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

  // 6. Dashboard port available
  if (config.dashboard.enabled) {
    const portAvailable = await checkPort(config.dashboard.port);
    if (portAvailable) {
      checks.push({ name: 'Dashboard port', status: 'ok', detail: `${config.dashboard.port} available` });
    } else {
      const owner = await getPortOwner(config.dashboard.port);
      if (owner.isOurs) {
        checks.push({ name: 'Dashboard port', status: 'ok', detail: `${config.dashboard.port} — ${owner.name}` });
      } else {
        checks.push({
          name: 'Dashboard port',
          status: 'warn',
          detail: `${config.dashboard.port} in use by ${owner.name}`,
        });
      }
    }
  } else {
    checks.push({ name: 'Dashboard', status: 'ok', detail: 'disabled' });
  }

  // Print results
  console.log('\nknowledge-graph doctor\n');
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

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port }, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(true);
    });
  });
}

async function getPortOwner(port: number): Promise<{ name: string; isOurs: boolean }> {
  try {
    const output = execSync(`lsof -i :${port} -sTCP:LISTEN -P -n 2>/dev/null | tail -1`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (!output) return { name: 'unknown', isOurs: false };
    const parts = output.split(/\s+/);
    const pid = parts[1] || '';
    // Check actual command line to identify knowledge-graph
    if (pid) {
      try {
        const cmdline = execSync(`ps -p ${pid} -o args= 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        if (cmdline.includes('knowledge-graph') || cmdline.includes('cli.js')) {
          return { name: `knowledge-graph (PID ${pid})`, isOurs: true };
        }
        return { name: `${cmdline.split(/\s+/).slice(0, 3).join(' ')} (PID ${pid})`, isOurs: false };
      } catch { /* fall through */ }
    }
    const command = parts[0] || 'unknown';
    return { name: `${command} (PID ${pid})`, isOurs: false };
  } catch {
    return { name: 'unknown', isOurs: false };
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
  const config = resolveConfig(parsed);
  killExistingServers(config.db.path);
  const { main } = await import('./index.js');
  await main(config);
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
