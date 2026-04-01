#!/usr/bin/env node

import { join, dirname } from 'path';
import { homedir } from 'os';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  accessSync,
  statSync,
  readdirSync,
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
  dryRun: boolean;
  help: boolean;
  version: boolean;
  positionalArgs: string[];
  domain?: string;
  category?: string;
  lifecycle?: string;
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
  let dryRun = false;
  let help = false;
  let version = false;
  const positionalArgs: string[] = [];
  let domain: string | undefined;
  let category: string | undefined;
  let lifecycle: string | undefined;

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
      case '--domain':
        domain = rawArgs[++i];
        break;
      case '--category':
        category = rawArgs[++i];
        break;
      case '--lifecycle':
        lifecycle = rawArgs[++i];
        break;
      case '--keep-data':
        keepData = true;
        break;
      case '--dry-run':
        dryRun = true;
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
          } else if (command) {
            positionalArgs.push(arg);
          } else {
            command = arg;
          }
        }
        break;
    }
  }

  return { command, port, storageBackend, dbPath, ollamaUrl, ollamaModel, keepData, force, dryRun, help, version, positionalArgs, domain, category, lifecycle };
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
  status             Show all registered projects and daemon status
  init [--force]     Initialize .knowledge-graph/ in current directory
  serve-standalone   Start daemon + dashboard (no MCP, standalone mode)
  setup              Write config + MCP settings
  setup-hooks        Install KG enforcement hooks into current project
  remove-hooks       Remove KG enforcement hooks from current project
  setup-skills       Install KG usage skills into current project (.claude/skills/)
  remove-skills      Remove KG skills from current project
  doctor             Check dependencies (Ollama, DB, Node, daemon)
  list               List knowledge chunks (--domain, --category, --lifecycle)
  query <topic>      Search knowledge by topic (--domain)
  sync status        Show sync state (chunks/edges tracked, last export/import)
  sync export        Full export to sync/ (--dry-run to preview)
  sync import        Delta import from sync/ files
  sync resolve <id> <action>  Resolve lifecycle conflict (keep-local|accept-remote)
  prime              Output skill context for hook injection (SessionStart/PreCompact)
  context            Auto-query KG with user prompt (UserPromptSubmit hook)
  logs               View recent daemon logs (last 100 entries)
  reset-db           Delete the database (all chunks, edges, embeddings)
  uninstall          Remove installed files, config, and MCP registration

OPTIONS
  --storage <backend>   Storage backend: kuzu or surreal (default: kuzu)
  --db-path <path>      Override database path
  --ollama-url <url>    Ollama API endpoint
  --ollama-model <name> Embedding model name
  --domain <name>       Filter by domain
  --category <name>     Filter by category (fact, rule, insight, question, workflow)
  --lifecycle <name>    Filter by lifecycle (hypothesis, active, validated, promoted, canonical, refuted)
  --dry-run             Preview sync export without writing files
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
  knowledge-graph sync status             # Show sync state
  knowledge-graph sync export             # Full export to sync/
  knowledge-graph sync export --dry-run   # Preview export without writing
  knowledge-graph sync import             # Delta import from sync files
  knowledge-graph sync resolve abc12345 keep-local     # Keep local lifecycle
  knowledge-graph sync resolve abc12345 accept-remote  # Accept remote lifecycle
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

  // 6. Enforcement hooks (existence + staleness)
  const hooksDir = join(process.cwd(), '.claude', 'hooks');
  const expectedHooks = [
    'kg-require-domain-check.sh',
    'kg-source-category-check.sh',
    'kg-entity-decomposition-check.sh',
    'kg-require-golden-evidence.sh',
    'kg-require-validate-evidence.sh',
    'kg-mark-domains-checked.sh',
    'kg-activity-tracker.sh',
    'kg-track-code-edits.sh',
    'kg-mark-tool-used.sh',
    'kg-tool-failure.sh',
    'kg-session-end-cleanup.sh',
    'kg-learning-capture-check.sh',
    'kg-require-consult-before-edit.sh',
    'kg-mark-consulted.sh',
    'kg-mark-consulted-bash.sh',
  ];
  const foundHooks = expectedHooks.filter((h) => existsSync(join(hooksDir, h)));
  if (foundHooks.length === expectedHooks.length) {
    // Check staleness: compare setup-hooks.sh mtime vs installed hooks
    const setupScript = join(homedir(), '.knowledge-graph', 'scripts', 'setup-hooks.sh');
    let hookStale = false;
    if (existsSync(setupScript)) {
      const sourceMtime = statSync(setupScript).mtimeMs;
      const oldestHook = Math.min(...foundHooks.map(h => statSync(join(hooksDir, h)).mtimeMs));
      hookStale = sourceMtime > oldestHook;
    }
    if (hookStale) {
      checks.push({ name: 'Hooks', status: 'warn', detail: `${foundHooks.length}/${expectedHooks.length} installed but STALE — run: kg setup-hooks` });
    } else {
      checks.push({ name: 'Hooks', status: 'ok', detail: `${foundHooks.length}/${expectedHooks.length} scripts installed` });
    }
  } else if (foundHooks.length === 0) {
    checks.push({ name: 'Hooks', status: 'warn', detail: `not installed — run: kg setup-hooks` });
  } else {
    const missing = expectedHooks.filter((h) => !foundHooks.includes(h));
    checks.push({ name: 'Hooks', status: 'warn', detail: `${foundHooks.length}/${expectedHooks.length} — missing: ${missing.join(', ')}. Run: kg setup-hooks` });
  }

  // 6b. Life Knowledge tool registrations in settings.local.json
  const settingsFile = join(process.cwd(), '.claude', 'settings.local.json');
  if (existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(readFileSync(settingsFile, 'utf-8'));
      const postToolUse = settings?.hooks?.PostToolUse ?? [];
      const lifeMatchers = ['life_store', 'life_feedback', 'life_draft_skill'];
      const registeredLifeTools = lifeMatchers.filter(tool =>
        postToolUse.some((entry: { matcher?: string }) =>
          entry.matcher?.includes(tool)
        )
      );
      if (registeredLifeTools.length === lifeMatchers.length) {
        checks.push({ name: 'Life tools', status: 'ok', detail: `${registeredLifeTools.length}/${lifeMatchers.length} registered (audit hooks)` });
      } else if (registeredLifeTools.length === 0) {
        checks.push({ name: 'Life tools', status: 'warn', detail: `not registered — run: kg setup-hooks` });
      } else {
        const missing = lifeMatchers.filter(t => !registeredLifeTools.includes(t));
        checks.push({ name: 'Life tools', status: 'warn', detail: `${registeredLifeTools.length}/${lifeMatchers.length} — missing: ${missing.join(', ')}. Run: kg setup-hooks` });
      }
    } catch {
      checks.push({ name: 'Life tools', status: 'warn', detail: 'could not parse settings.local.json' });
    }
  } else if (foundHooks.length > 0) {
    // Hooks exist but no settings file — unusual
    checks.push({ name: 'Life tools', status: 'warn', detail: 'settings.local.json not found — run: kg setup-hooks' });
  }

  // 6c. CLI hook registrations (kg prime on SessionStart/PreCompact, kg context on UserPromptSubmit)
  if (existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(readFileSync(settingsFile, 'utf-8'));
      const expectedCliHooks: { event: string; command: string }[] = [
        { event: 'SessionStart', command: 'kg prime' },
        { event: 'PreCompact', command: 'kg prime' },
        { event: 'UserPromptSubmit', command: 'kg context' },
      ];
      const registered = expectedCliHooks.filter(({ event, command }) => {
        const entries = settings?.hooks?.[event] ?? [];
        return entries.some((entry: { hooks?: { command?: string }[] }) =>
          entry.hooks?.some((h: { command?: string }) => h.command === command)
        );
      });
      if (registered.length === expectedCliHooks.length) {
        checks.push({ name: 'CLI hooks', status: 'ok', detail: `${registered.length}/${expectedCliHooks.length} registered (prime, context)` });
      } else if (registered.length === 0) {
        checks.push({ name: 'CLI hooks', status: 'warn', detail: `not registered — run: kg setup-hooks` });
      } else {
        const missing = expectedCliHooks
          .filter(({ event, command }) => !registered.some(r => r.event === event && r.command === command))
          .map(({ event, command }) => `${command}@${event}`);
        checks.push({ name: 'CLI hooks', status: 'warn', detail: `${registered.length}/${expectedCliHooks.length} — missing: ${missing.join(', ')}. Run: kg setup-hooks` });
      }
    } catch { /* ignore parse errors — already caught in 6b */ }
  }

  // 6d. KG usage skills (existence + staleness via content comparison)
  const skillsDir = join(process.cwd(), '.claude', 'skills', 'knowledge-graph');
  const skillsSourceDir = join(homedir(), '.knowledge-graph', 'skills');
  const expectedSkills = [
    'knowledge-graph-guide',
    'kg-storing',
    'kg-exploring',
    'kg-lifecycle',
    'kg-life-knowledge',
    'kg-troubleshooting',
  ];
  const foundSkills = expectedSkills.filter((s) => existsSync(join(skillsDir, s, 'SKILL.md')));
  if (foundSkills.length === expectedSkills.length) {
    // Check staleness: compare content with source
    let staleSkills = 0;
    if (existsSync(skillsSourceDir)) {
      for (const skill of foundSkills) {
        const src = join(skillsSourceDir, skill, 'SKILL.md');
        const dst = join(skillsDir, skill, 'SKILL.md');
        if (existsSync(src)) {
          try {
            const srcContent = readFileSync(src, 'utf-8');
            const dstContent = readFileSync(dst, 'utf-8');
            if (srcContent !== dstContent) staleSkills++;
          } catch { /* ignore read errors */ }
        }
      }
    }
    if (staleSkills > 0) {
      checks.push({ name: 'Skills', status: 'warn', detail: `${foundSkills.length}/${expectedSkills.length} installed, ${staleSkills} STALE — run: kg setup-skills` });
    } else {
      checks.push({ name: 'Skills', status: 'ok', detail: `${foundSkills.length}/${expectedSkills.length} installed` });
    }
  } else if (foundSkills.length === 0) {
    checks.push({ name: 'Skills', status: 'warn', detail: `not installed — run: kg setup-skills` });
  } else {
    const missing = expectedSkills.filter((s) => !foundSkills.includes(s));
    checks.push({ name: 'Skills', status: 'warn', detail: `${foundSkills.length}/${expectedSkills.length} — missing: ${missing.join(', ')}. Run: kg setup-skills` });
  }

  // 7. Log file
  if (project) {
    const logFile = join(project.kgDir, 'logs', 'daemon.log');
    if (existsSync(logFile)) {
      const logSize = statSync(logFile).size;
      const sizeKB = Math.round(logSize / 1024);
      const rotated = [1, 2, 3].filter(i => existsSync(logFile + '.' + i)).length;
      checks.push({ name: 'Logs', status: 'ok', detail: `${sizeKB}KB, ${rotated} rotated` });
    } else {
      checks.push({ name: 'Logs', status: 'warn', detail: 'no log file yet — start the daemon to create logs' });
    }
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
// Status command — show all projects and daemon health
// ============================================================

async function runStatus(): Promise<void> {
  const allProjects = listProjects();
  const currentProject = discoverProject(process.cwd());

  // Deduplicate by path — keep the most recently accessed entry
  const byPath = new Map<string, typeof allProjects[number]>();
  for (const p of allProjects) {
    const existing = byPath.get(p.path);
    if (!existing || p.last_accessed > existing.last_accessed) {
      byPath.set(p.path, p);
    }
  }
  const projects = [...byPath.values()];

  console.log(`\nknowledge-graph status\n`);

  if (projects.length === 0) {
    console.log('  No registered projects. Run "kg init" in a project directory.\n');
    return;
  }

  const reset = '\x1b[0m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const cyan = '\x1b[36m';

  for (const entry of projects) {
    const isCurrent = currentProject?.projectId === entry.id;
    const marker = isCurrent ? ` ${cyan}<-- current${reset}` : '';
    console.log(`  ${bold}${entry.name}${reset}${marker}`);
    console.log(`  ${dim}${entry.path}${reset}`);
    console.log(`  ${dim}ID: ${entry.id.slice(0, 8)}...${reset}`);

    // Check daemon files
    const kgDir = join(entry.path, '.knowledge-graph');
    const portFile = join(kgDir, 'daemon.port');
    const pidFile = join(kgDir, 'daemon.pid');

    let port: number | null = null;
    let pid: number | null = null;

    if (existsSync(portFile)) {
      port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10) || null;
    }
    if (existsSync(pidFile)) {
      pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10) || null;
    }

    if (!port && !pid) {
      console.log(`  ${dim}Daemon: ${reset}${yellow}stopped${reset}`);
      console.log('');
      continue;
    }

    // Check if PID is actually alive
    let pidAlive = false;
    if (pid) {
      try {
        process.kill(pid, 0);
        pidAlive = true;
      } catch {
        pidAlive = false;
      }
    }

    if (!pidAlive && pid) {
      console.log(`  ${dim}Daemon: ${reset}${red}stale${reset} ${dim}(PID ${pid} not running, files remain)${reset}`);
      console.log('');
      continue;
    }

    // Health check via HTTP
    if (port) {
      const url = `http://127.0.0.1:${port}`;
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const health = await res.json() as {
            status: string;
            project_id: string;
            clients: number;
            uptime_ms: number;
          };

          const uptimeSec = Math.floor(health.uptime_ms / 1000);
          const uptimeMin = Math.floor(uptimeSec / 60);
          const uptimeHr = Math.floor(uptimeMin / 60);
          let uptimeStr: string;
          if (uptimeHr > 0) {
            uptimeStr = `${uptimeHr}h ${uptimeMin % 60}m`;
          } else if (uptimeMin > 0) {
            uptimeStr = `${uptimeMin}m ${uptimeSec % 60}s`;
          } else {
            uptimeStr = `${uptimeSec}s`;
          }

          console.log(`  ${dim}Daemon: ${reset}${green}running${reset}  ${dim}port=${port}  pid=${pid}  clients=${health.clients}  uptime=${uptimeStr}${reset}`);
          console.log(`  ${dim}Dashboard: ${reset}${url}`);
        } else {
          console.log(`  ${dim}Daemon: ${reset}${yellow}unhealthy${reset} ${dim}(HTTP ${res.status} on port ${port})${reset}`);
        }
      } catch {
        console.log(`  ${dim}Daemon: ${reset}${red}unreachable${reset} ${dim}(port ${port}, PID ${pid})${reset}`);
      }
    } else if (pidAlive) {
      console.log(`  ${dim}Daemon: ${reset}${yellow}running (no port file)${reset} ${dim}PID ${pid}${reset}`);
    }

    console.log('');
  }

  // Summary
  console.log(`  ${dim}${projects.length} project(s) registered${reset}\n`);
}

// ============================================================
// Logs command
// ============================================================

async function runLogs(): Promise<void> {
  const project = discoverProject(process.cwd());
  if (!project) {
    console.error('No .knowledge-graph/ found. Run from a project directory.');
    process.exit(1);
  }

  const logFile = join(project.kgDir, 'logs', 'daemon.log');
  if (!existsSync(logFile)) {
    console.log('No log file found. Start the daemon first.');
    process.exit(0);
  }

  const content = readFileSync(logFile, 'utf-8');
  const lines = content.trim().split('\n').slice(-100);
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const colors: Record<string, string> = {
    error: '\x1b[31m',
    warn: '\x1b[33m',
    info: '\x1b[32m',
    debug: '\x1b[2m',
  };

  for (const line of lines) {
    try {
      const e = JSON.parse(line) as { ts: string; level: string; source: string; msg: string };
      const time = e.ts.split('T')[1]?.split('.')[0] ?? e.ts;
      console.log(`${dim}${time}${reset} ${colors[e.level] ?? ''}${e.level.padEnd(5)}${reset} ${dim}[${e.source}]${reset} ${e.msg}`);
    } catch {
      console.log(line);
    }
  }
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
// Setup/Remove hooks commands
// ============================================================

function getScriptsDir(): string {
  const kgHome = join(homedir(), '.knowledge-graph');
  return join(kgHome, 'scripts');
}

async function runSetupHooks(): Promise<void> {
  // Check jq is available
  try {
    execSync('command -v jq', { stdio: 'ignore' });
  } catch {
    console.error('Error: jq is required for hook setup. Install: brew install jq');
    process.exit(1);
  }

  const scriptsDir = getScriptsDir();
  const scriptPath = join(scriptsDir, 'setup-hooks.sh');

  if (!existsSync(scriptPath)) {
    console.error(`Error: setup-hooks.sh not found at ${scriptPath}`);
    console.error('Run "bash install.sh" to reinstall knowledge-graph.');
    process.exit(1);
  }

  console.log('Installing KG enforcement hooks...\n');
  try {
    execSync(`bash "${scriptPath}"`, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('Hook setup failed.');
    process.exit(1);
  }

  console.log('\nRestart Claude Code to activate the hooks.');
}

async function runRemoveHooks(): Promise<void> {
  // Check jq is available
  try {
    execSync('command -v jq', { stdio: 'ignore' });
  } catch {
    console.error('Error: jq is required for hook removal. Install: brew install jq');
    process.exit(1);
  }

  const scriptsDir = getScriptsDir();
  const scriptPath = join(scriptsDir, 'remove-hooks.sh');

  if (!existsSync(scriptPath)) {
    console.error(`Error: remove-hooks.sh not found at ${scriptPath}`);
    console.error('Run "bash install.sh" to reinstall knowledge-graph.');
    process.exit(1);
  }

  console.log('Removing KG enforcement hooks...\n');
  try {
    execSync(`bash "${scriptPath}"`, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('Hook removal failed.');
    process.exit(1);
  }

  console.log('\nHooks removed. Restart Claude Code to apply changes.');
}

// ============================================================
// Prime command — output skill context for hook injection
// ============================================================

function buildPrimeContent(): string {
  const skillsDir = getSkillsSourceDir();
  const sections: string[] = [];

  // --- Guide skill (full content) ---
  const guidePath = join(skillsDir, 'knowledge-graph-guide', 'SKILL.md');
  if (existsSync(guidePath)) {
    const raw = readFileSync(guidePath, 'utf-8');
    // Strip frontmatter
    const stripped = raw.replace(/^---[\s\S]*?---\s*/, '');
    sections.push(stripped.trim());
  }

  // --- Condensed kg-storing ---
  const storingPath = join(skillsDir, 'kg-storing', 'SKILL.md');
  if (existsSync(storingPath)) {
    sections.push(`## Storing Rules (from kg-storing)

- Categories: fact (verified statement), rule (constraint+rationale), insight (inferred, needs confirmation), question (open question), workflow (multi-step process)
- Source rules (hook-enforced): insight/question MUST have source (observed:*, code-review:*, user-confirmed:*, discussion-with-user:*). fact/rule/workflow CANNOT use observed:* or code-review:*
- Interview protocol: If inferring from code → store as insight with source:observed:* → ask user to confirm → evolve to fact/rule
- Content: natural language only, no code snippets. Keywords 1-15, domain max 50 chars, summary max 200 chars
- Always call knowledge_list first and reuse existing domains`);
  }

  // --- Condensed kg-exploring ---
  const exploringPath = join(skillsDir, 'kg-exploring', 'SKILL.md');
  if (existsSync(exploringPath)) {
    sections.push(`## Exploring Rules (from kg-exploring)

- Query before store: knowledge_list for domain overview, knowledge_query for semantic deep search
- Trust order: canonical > promoted > validated > active > hypothesis > refuted
- Confidence >= 0.8 is trustworthy. Refuted chunks excluded from query by default
- Domain reuse: check existing domains, never create synonyms (e.g., use "dependency-injection" not "di" if former exists)`);
  }

  // --- Condensed kg-lifecycle ---
  const lifecyclePath = join(skillsDir, 'kg-lifecycle', 'SKILL.md');
  if (existsSync(lifecyclePath)) {
    sections.push(`## Lifecycle Rules (from kg-lifecycle)

- State machine: hypothesis →[3x confirm + conf>=0.85]→ validated →[golden evidence]→ promoted →[conf>=0.9]→ canonical
- Direct path: active →[promote]→ promoted (for fact/rule/workflow)
- Validate: always include evidence (hook blocks without it). Prefixes: user:, docs:, code:, tests:, task:
- Promote: requires ALL 4 golden evidence sources in reason: [docs:path] [code:path:line] [tests:path] [task:issue-id]
- Refute: confidence < 0.2 → refuted. Confirm refuted chunk with conf >= 0.2 → revives to hypothesis`);
  }

  // --- Pointer to sub-skills ---
  sections.push(`## Detailed Workflows

For complete workflows, read the sub-skills in .claude/skills/knowledge-graph/:
- kg-storing/SKILL.md — full storing workflow, category decision table, source rules
- kg-exploring/SKILL.md — search workflow, trust assessment, filter tips
- kg-lifecycle/SKILL.md — validation, promotion, golden evidence details
- kg-life-knowledge/SKILL.md — operational learnings (coding gotchas, patterns)
- kg-troubleshooting/SKILL.md — error diagnosis, common failures`);

  return sections.join('\n\n');
}

/**
 * Fetch a mini-briefing from the running daemon.
 * Returns formatted text or empty string if daemon unavailable.
 * Non-blocking: 2s timeout on health, 3s on RPC.
 */
async function fetchDaemonBriefing(project: ProjectInfo): Promise<string> {
  try {
    if (!existsSync(project.daemonPortFile)) return '';

    const port = parseInt(readFileSync(project.daemonPortFile, 'utf-8').trim(), 10);
    if (!(port > 0)) return '';

    const url = `http://127.0.0.1:${port}`;

    // Health check (2s timeout)
    const healthRes = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    const health = await healthRes.json() as { status: string; project_id: string };
    if (health.status !== 'ok' || health.project_id !== project.projectId) return '';

    // Fetch briefing via JSON-RPC (3s timeout)
    const rpcRes = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'knowledge_briefing',
        params: { top_domains: 10, recent_days: 7 },
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    });
    const rpcBody = await rpcRes.json() as { result?: BriefingData; error?: unknown };
    if (!rpcBody.result) return '';

    return formatCondensedBriefing(rpcBody.result);
  } catch {
    // Daemon not running, timeout, or any error — skip silently
    return '';
  }
}

/** Subset of BriefingResult used for prime output formatting */
interface BriefingData {
  domains: Array<{
    name: string;
    chunk_count: number;
    top_lifecycle: string;
    avg_confidence: number;
    open_questions: number;
  }>;
  stats: {
    total_chunks: number;
    total_edges: number;
    by_lifecycle: Record<string, number>;
  };
  open_questions: Array<{
    id: string;
    summary: string;
    domain: string;
  }>;
  stale_knowledge: Array<{
    id: string;
    summary: string;
    domain: string;
  }>;
}

function formatCondensedBriefing(data: BriefingData): string {
  const lines: string[] = [];
  const { stats, domains, open_questions, stale_knowledge } = data;

  if (stats.total_chunks === 0) return '';

  lines.push('## Live Knowledge Briefing');
  lines.push('');
  lines.push(`**${stats.total_chunks} chunks** across **${domains.length} domains**, ${stats.total_edges} edges.`);

  // Lifecycle summary
  const lcParts: string[] = [];
  for (const [lc, count] of Object.entries(stats.by_lifecycle)) {
    if (count > 0) lcParts.push(`${count} ${lc}`);
  }
  if (lcParts.length > 0) lines.push(`Lifecycle: ${lcParts.join(', ')}`);

  // Domain table (compact)
  if (domains.length > 0) {
    lines.push('');
    lines.push('| Domain | Chunks | Confidence | Questions |');
    lines.push('|--------|--------|------------|-----------|');
    for (const d of domains) {
      const qMark = d.open_questions > 0 ? ` ${d.open_questions}` : '0';
      lines.push(`| ${d.name} | ${d.chunk_count} | ${d.avg_confidence.toFixed(2)} | ${qMark} |`);
    }
  }

  // Open questions — these are the key actionable items
  if (open_questions.length > 0) {
    lines.push('');
    lines.push(`**${open_questions.length} open question(s)** — consider investigating:`);
    for (const q of open_questions.slice(0, 5)) {
      lines.push(`- [${q.domain}] ${q.summary}`);
    }
    if (open_questions.length > 5) {
      lines.push(`- ... and ${open_questions.length - 5} more (use knowledge_list with category filter)`);
    }
  }

  // Stale knowledge
  if (stale_knowledge.length > 0) {
    lines.push('');
    lines.push(`**${stale_knowledge.length} stale chunk(s)** — confidence decayed below 0.5, may need re-validation.`);
  }

  return lines.join('\n');
}

async function runPrime(): Promise<void> {
  // Read stdin for hook input JSON
  let source = 'startup';
  let sessionId = '';

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf-8').trim();
    if (input) {
      const parsed = JSON.parse(input);
      source = parsed.source || 'startup';
      sessionId = parsed.session_id || '';
    }
  } catch {
    // No stdin or invalid JSON — default to startup
  }

  // Handle clear: cleanup marker files
  if (source === 'clear') {
    const tmpDir = process.env.TMPDIR || '/tmp';
    const markerDir = join(tmpDir, `claude-kg-hooks-${process.getuid?.() ?? 0}`);
    if (sessionId && existsSync(markerDir)) {
      const { unlinkSync } = await import('fs');
      const markers = [
        `kg-domains-checked-${sessionId}`,
        `kg-tool-used-${sessionId}`,
        `kg-code-edits-${sessionId}`,
        `kg-consulted-${sessionId}`,
        `kg-consult-failed-${sessionId}`,
      ];
      for (const m of markers) {
        try { unlinkSync(join(markerDir, m)); } catch { /* ignore */ }
      }
    }
  }

  // Discover project early — needed for briefing + activity log
  const project = discoverProject(process.cwd());

  // Session-aware header — prescriptive checklists matching beads style
  let header: string;
  switch (source) {
    case 'startup':
      header = `# Knowledge Graph Active
Before editing files, consult KG: \`kg list\` then \`kg query '<topic>'\`
If blocked, run commands above. If KG down, \`kg doctor\`.`;
      break;
    case 'compact':
      header = `# KNOWLEDGE GRAPH — CONTEXT RESTORED

MANDATORY: Context was compacted. Re-query before continuing:
[ ] 1. knowledge_query('<topic>') — restore domain context for areas you are working on
[ ] 2. Check open questions from briefing below (if any)

Do NOT rely on memory of previous KG results — they were compacted. Re-query now.`;
      break;
    case 'resume':
      header = `# KNOWLEDGE GRAPH — SESSION RESUMED

If working on domain tasks:
[ ] 1. knowledge_list — check for new knowledge since last session
[ ] 2. knowledge_query('<topic>') — for areas you will touch`;
      break;
    case 'clear':
      header = '[Knowledge Graph] Session cleared.';
      break;
    default:
      header = '[Knowledge Graph] Active.';
      break;
  }

  // Fetch live briefing from daemon (non-blocking, fast)
  let briefingText = '';
  if (project && (source === 'startup' || source === 'compact' || source === 'resume')) {
    briefingText = await fetchDaemonBriefing(project);
  }

  // Build skill content
  const skillContent = buildPrimeContent();

  let additionalContext: string;
  if (skillContent) {
    // Assemble: header → briefing (if available) → skill guide
    const parts = [header];
    if (briefingText) parts.push(briefingText);
    parts.push(skillContent);
    additionalContext = parts.join('\n\n');
  } else {
    // Fallback: minimal context (same as old kg-session-start.sh)
    const parts = [header];
    if (briefingText) parts.push(briefingText);
    parts.push('Use knowledge_list to check existing domains before storing new knowledge. Domain knowledge (WHY) → knowledge_store. Coding tips (HOW) → life_store.');
    additionalContext = parts.join('\n\n');
  }

  // Log session event to activity.log
  try {
    if (project) {
      const activityLog = join(project.kgDir, 'activity.log');
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        session: sessionId || 'unknown',
        event: 'session_start',
        source,
        briefing_injected: briefingText.length > 0,
      });
      appendFileSync(activityLog, entry + '\n');
    }
  } catch { /* non-fatal */ }

  // Output hook-compatible JSON to stdout
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  };

  console.log(JSON.stringify(output));
}

// ============================================================
// Context command (UserPromptSubmit auto-query hook)
// ============================================================

function shouldSkipPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length < 15) return true;
  if (trimmed.startsWith('/')) return true;
  const trivial = new Set([
    'yes', 'no', 'ok', 'sure', 'thanks', 'done', 'continue',
    'y', 'n', 'lgtm', 'looks good', 'go ahead', 'proceed',
    'correct', 'right', 'nope', 'yep', 'yeah', 'please',
    'thank you', 'thx', 'ty', 'ok thanks',
  ]);
  return trivial.has(trimmed.toLowerCase());
}

interface ContextChunkResult {
  id: string;
  content: string;
  metadata: {
    summary: string;
    domain: string;
    category: string;
    importance: string;
    confidence: number;
    lifecycle: string;
    keywords: string[];
  };
  score: number;
}

function formatContextResults(chunks: ContextChunkResult[], prompt: string): string {
  const top = chunks.slice(0, 5);
  if (top.length === 0) return '';

  const relevant = top.filter(c => c.score >= 0.3);
  if (relevant.length === 0) return '';

  const lines: string[] = [];
  const promptExcerpt = prompt.slice(0, 60).replace(/\n/g, ' ');

  lines.push(`## Domain Knowledge (auto-retrieved for: "${promptExcerpt}")`);
  lines.push('');
  lines.push('**MANDATORY: Use this knowledge to answer FIRST. Only scan the codebase if these results do not address the question.**');
  lines.push('');

  for (const c of relevant) {
    const conf = c.metadata.confidence.toFixed(2);
    const domain = c.metadata.domain || 'unknown';
    const category = c.metadata.category;
    const lifecycle = c.metadata.lifecycle;

    lines.push(`- **[${domain}]** (${category}, conf:${conf}, ${lifecycle}) ${c.metadata.summary}`);

    if (c.metadata.confidence >= 0.5) {
      const content = c.content.slice(0, 200).replace(/\n/g, ' ');
      lines.push(`  ${content}`);
    }
  }

  return lines.join('\n');
}

async function runContext(): Promise<void> {
  // 1. Read stdin for hook input JSON
  let promptText = '';
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf-8').trim();
    if (input) {
      const parsed = JSON.parse(input);
      promptText = parsed.prompt || '';
    }
  } catch {
    // No stdin or invalid JSON — exit silently
  }

  // 2. Skip trivial prompts
  if (shouldSkipPrompt(promptText)) {
    process.exit(0);
    return;
  }

  // 3. Discover project + daemon
  const project = discoverProject(process.cwd());
  if (!project) {
    process.exit(0);
    return;
  }
  const daemonUrl = await getDaemonUrl(project);
  if (!daemonUrl) {
    process.exit(0);
    return;
  }

  // 4. Query KG via JSON-RPC
  try {
    const res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'knowledge_query',
        params: {
          query: promptText.slice(0, 500),
          filters: { min_confidence: 0.3 },
        },
        id: 1,
      }),
      signal: AbortSignal.timeout(2500),
    });

    const body = await res.json() as {
      result?: { chunks: ContextChunkResult[]; total: number };
      error?: { message: string };
    };

    if (!body.result || body.result.total === 0) {
      process.exit(0);
      return;
    }

    // 5. Format + output
    const ctx = formatContextResults(body.result.chunks, promptText);
    if (!ctx) {
      process.exit(0);
      return;
    }

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: ctx,
      },
    }));
  } catch {
    // Timeout, connection error — exit silently
    process.exit(0);
  }
}

// ============================================================
// Setup/Remove skills commands
// ============================================================

function getSkillsSourceDir(): string {
  return join(homedir(), '.knowledge-graph', 'skills');
}

const EXPECTED_SKILLS = [
  'knowledge-graph-guide',
  'kg-storing',
  'kg-exploring',
  'kg-lifecycle',
  'kg-life-knowledge',
  'kg-troubleshooting',
];

async function runSetupSkills(): Promise<void> {
  const sourceDir = getSkillsSourceDir();
  if (!existsSync(sourceDir)) {
    console.error(`Error: KG skills not found at ${sourceDir}`);
    console.error('Run "bash install.sh" to reinstall knowledge-graph.');
    process.exit(1);
  }

  const targetDir = join(process.cwd(), '.claude', 'skills', 'knowledge-graph');
  console.log('Installing KG skills...\n');
  console.log(`  Source: ${sourceDir}`);
  console.log(`  Target: ${targetDir}\n`);

  let installed = 0;
  let skipped = 0;

  for (const skill of EXPECTED_SKILLS) {
    const src = join(sourceDir, skill, 'SKILL.md');
    const dst = join(targetDir, skill, 'SKILL.md');

    if (!existsSync(src)) {
      console.log(`  ! ${skill}: source not found, skipping`);
      skipped++;
      continue;
    }

    mkdirSync(join(targetDir, skill), { recursive: true });

    // Check if target exists and compare content
    if (existsSync(dst)) {
      const srcContent = readFileSync(src, 'utf-8');
      const dstContent = readFileSync(dst, 'utf-8');
      if (srcContent === dstContent) {
        console.log(`  = ${skill}: up to date`);
        installed++;
        continue;
      }
    }

    // Copy
    const content = readFileSync(src, 'utf-8');
    writeFileSync(dst, content);
    console.log(`  + ${skill}: installed`);
    installed++;
  }

  console.log(`\nSkills: ${installed} installed, ${skipped} skipped.`);
  console.log('Restart Claude Code to activate skills.');
}

async function runRemoveSkills(): Promise<void> {
  const targetDir = join(process.cwd(), '.claude', 'skills', 'knowledge-graph');

  if (!existsSync(targetDir)) {
    console.log('No KG skills found in this project.');
    return;
  }

  console.log('Removing KG skills...\n');

  let removed = 0;
  for (const skill of EXPECTED_SKILLS) {
    const dir = join(targetDir, skill);
    if (existsSync(dir)) {
      const { rmSync } = await import('fs');
      rmSync(dir, { recursive: true, force: true });
      console.log(`  - ${skill}: removed`);
      removed++;
    }
  }

  // Remove parent dir if empty
  try {
    const remaining = (await import('fs')).readdirSync(targetDir);
    if (remaining.length === 0) {
      (await import('fs')).rmSync(targetDir, { recursive: true });
      console.log(`  - knowledge-graph/: removed (empty)`);
    }
  } catch { /* ignore */ }

  console.log(`\n${removed} skills removed.`);
}

// ============================================================
// CLI list / query helpers
// ============================================================

/**
 * Get the daemon URL from the port file without starting a new daemon.
 * Returns null if no daemon is running.
 */
async function getDaemonUrl(project: ProjectInfo): Promise<string | null> {
  if (!existsSync(project.daemonPortFile)) return null;
  const port = parseInt(readFileSync(project.daemonPortFile, 'utf-8').trim(), 10);
  if (!(port > 0)) return null;
  const url = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    const health = await res.json() as { status: string; project_id: string };
    if (health.status === 'ok' && health.project_id === project.projectId) {
      return url;
    }
  } catch { /* daemon unreachable */ }
  return null;
}

/**
 * Write a session marker file for hook integration.
 * Uses KG_SESSION_ID env var if available.
 */
function writeMarker(name: string): void {
  const sessionId = process.env.KG_SESSION_ID;
  if (!sessionId) return;
  const tmpDir = process.env.TMPDIR || '/tmp';
  const markerDir = join(tmpDir, `claude-kg-hooks-${process.getuid?.() ?? 0}`);
  try {
    mkdirSync(markerDir, { mode: 0o700, recursive: true });
    writeFileSync(join(markerDir, `${name}-${sessionId}`), '');
  } catch { /* non-fatal */ }
}

// ============================================================
// List command
// ============================================================

async function runList(parsed: ParsedArgs): Promise<void> {
  const project = discoverProject(process.cwd());
  if (!project) {
    console.error('No .knowledge-graph/ found. Run `kg init` first.');
    process.exit(1);
  }

  // Get daemon URL
  const daemonUrl = await getDaemonUrl(project);
  if (!daemonUrl) {
    writeMarker('kg-consult-failed');
    console.error('Daemon not running. Start with: kg serve');
    process.exit(1);
  }

  // Build filters
  const filters: Record<string, string> = {};
  if (parsed.domain) filters.domain = parsed.domain;
  if (parsed.category) filters.category = parsed.category;
  if (parsed.lifecycle) filters.lifecycle = parsed.lifecycle;

  try {
    const res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'knowledge_list',
        params: { filters, limit: 50 },
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json() as { result?: { chunks: any[] }; error?: { message: string } };

    if (body.error) {
      writeMarker('kg-consult-failed');
      console.error(`Error: ${body.error.message}`);
      process.exit(1);
    }

    writeMarker('kg-consulted');

    const chunks = body.result?.chunks ?? [];
    if (chunks.length === 0) {
      console.log('No chunks found.');
      return;
    }

    // Print table header
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    console.log(`\n${bold}${'ID'.padEnd(10)} ${'Domain'.padEnd(22)} ${'Category'.padEnd(10)} ${'Lifecycle'.padEnd(11)} ${'Conf'.padEnd(6)} Summary${reset}`);
    console.log(`${dim}${'─'.repeat(90)}${reset}`);

    for (const c of chunks) {
      const id = (c.id || '').slice(0, 8);
      const domain = (c.domain || '').slice(0, 20).padEnd(22);
      const category = (c.category || '').padEnd(10);
      const lifecycle = (c.lifecycle || '').padEnd(11);
      const conf = (c.effective_confidence ?? c.confidence ?? 0).toFixed(2).padEnd(6);
      const summary = (c.summary || '').slice(0, 50);
      console.log(`${dim}${id.padEnd(10)}${reset} ${domain} ${category} ${lifecycle} ${conf} ${summary}`);
    }

    console.log(`\n${dim}${chunks.length} chunk(s)${reset}\n`);
  } catch (e) {
    writeMarker('kg-consult-failed');
    console.error(`Failed to connect to daemon: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ============================================================
// Query command
// ============================================================

async function runQuery(parsed: ParsedArgs): Promise<void> {
  const project = discoverProject(process.cwd());
  if (!project) {
    console.error('No .knowledge-graph/ found. Run `kg init` first.');
    process.exit(1);
  }

  const queryText = parsed.positionalArgs.join(' ').trim();
  if (!queryText) {
    console.error('Usage: kg query <topic> [--domain <domain>]');
    process.exit(1);
  }

  const daemonUrl = await getDaemonUrl(project);
  if (!daemonUrl) {
    writeMarker('kg-consult-failed');
    console.error('Daemon not running. Start with: kg serve');
    process.exit(1);
  }

  const filters: Record<string, string> = {};
  if (parsed.domain) filters.domain = parsed.domain;

  try {
    const res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'knowledge_query',
        params: { query: queryText, filters },
        id: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json() as { result?: { chunks: any[]; total: number }; error?: { message: string } };

    if (body.error) {
      writeMarker('kg-consult-failed');
      console.error(`Error: ${body.error.message}`);
      process.exit(1);
    }

    writeMarker('kg-consulted');

    const results = body.result?.chunks ?? [];
    if (results.length === 0) {
      console.log(`No results for "${queryText}".`);
      return;
    }

    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const cyan = '\x1b[36m';

    console.log(`\n${bold}Results for "${queryText}"${reset} (${results.length} hits)\n`);

    for (const r of results) {
      const meta = r.metadata ?? {};
      const score = (r.score ?? 0).toFixed(3);
      const domain = meta.domain || '';
      const category = meta.category || '';
      const summary = meta.summary || '';
      const content = (r.content || '').slice(0, 120);
      console.log(`  ${cyan}${score}${reset}  ${bold}[${domain}]${reset} ${dim}(${category})${reset} ${summary}`);
      if (content) {
        console.log(`         ${dim}${content}${reset}`);
      }
      console.log('');
    }
  } catch (e) {
    writeMarker('kg-consult-failed');
    console.error(`Failed to connect to daemon: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ============================================================
// Sync commands
// ============================================================

async function runSyncStatus(): Promise<void> {
  const project = discoverProject(process.cwd());
  if (!project) {
    console.error('No .knowledge-graph/ found. Run `kg init` first.');
    process.exit(1);
  }

  const syncDir = join(project.kgDir, 'sync');
  const manifestPath = join(syncDir, 'manifest.json');
  const chunksDir = join(syncDir, 'chunks');
  const edgesDir = join(syncDir, 'edges');

  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';

  console.log(`\n${bold}KG Sync Status${reset}\n`);
  console.log(`  Sync directory: ${syncDir}/`);

  // Count chunk files
  let chunkCount = 0;
  if (existsSync(chunksDir)) {
    chunkCount = readdirSync(chunksDir).filter(f => f.endsWith('.json')).length;
  }
  console.log(`  Chunks tracked: ${chunkCount}`);

  // Count edge files
  let edgeCount = 0;
  if (existsSync(edgesDir)) {
    edgeCount = readdirSync(edgesDir).filter(f => f.endsWith('.json')).length;
  }
  console.log(`  Edges tracked:  ${edgeCount}`);

  // Read manifest for timestamps
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const lastExport = manifest.last_export_at || '(never)';
      const lastImport = manifest.last_import_at || '(never)';
      console.log(`  Last export:    ${lastExport}`);
      console.log(`  Last import:    ${lastImport}`);
    } catch {
      console.log(`  ${dim}Manifest unreadable${reset}`);
    }
  } else {
    console.log(`  Last export:    (never)`);
    console.log(`  Last import:    (never)`);
  }

  console.log('');
}

async function runSyncExport(parsed: ParsedArgs): Promise<void> {
  const project = discoverProject(process.cwd());
  if (!project) {
    console.error('No .knowledge-graph/ found. Run `kg init` first.');
    process.exit(1);
  }

  const daemonUrl = await getDaemonUrl(project);
  if (!daemonUrl) {
    console.error('Daemon not running. Start with: kg serve');
    process.exit(1);
  }

  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';

  try {
    const res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'sync_export',
        params: { dry_run: parsed.dryRun },
        id: 1,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json() as {
      result?: { chunks: number; edges: number; dry_run: boolean };
      error?: { message: string };
    };

    if (body.error) {
      console.error(`Error: ${body.error.message}`);
      process.exit(1);
    }

    const r = body.result!;
    if (r.dry_run) {
      console.log(`\n${bold}Sync Export (dry run)${reset}\n`);
      console.log(`  Would export ${r.chunks} chunks and ${r.edges} edges to sync/`);
      console.log(`  ${dim}Run without --dry-run to write files.${reset}`);
    } else {
      console.log(`\n${bold}Sync Export${reset}\n`);
      console.log(`  Exported ${r.chunks} chunks and ${r.edges} edges to sync/`);
    }
    console.log('');
  } catch (e) {
    console.error(`Failed to connect to daemon: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

async function runSyncImport(): Promise<void> {
  const project = discoverProject(process.cwd());
  if (!project) {
    console.error('No .knowledge-graph/ found. Run `kg init` first.');
    process.exit(1);
  }

  const daemonUrl = await getDaemonUrl(project);
  if (!daemonUrl) {
    console.error('Daemon not running. Start with: kg serve');
    process.exit(1);
  }

  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const yellow = '\x1b[33m';
  const reset = '\x1b[0m';

  try {
    const res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'sync_import',
        params: {},
        id: 1,
      }),
      signal: AbortSignal.timeout(120000), // Imports can be slow (embedding)
    });
    const body = await res.json() as {
      result?: {
        new_chunks: number;
        updated_chunks: number;
        deleted_chunks: number;
        blocked_chunks: Array<{
          sync_id: string;
          summary: string;
          local_lifecycle: string;
          remote_lifecycle: string;
          local_updated: string;
          remote_updated: string;
        }>;
        new_edges: number;
        removed_edges: number;
        relinked_chunks: number;
      };
      error?: { message: string };
    };

    if (body.error) {
      console.error(`Error: ${body.error.message}`);
      process.exit(1);
    }

    const r = body.result!;
    console.log(`\n${bold}Sync Import${reset}\n`);
    console.log(`  New chunks:     ${r.new_chunks}`);
    console.log(`  Updated chunks: ${r.updated_chunks}`);
    console.log(`  Deleted chunks: ${r.deleted_chunks}`);
    console.log(`  New edges:      ${r.new_edges}`);
    console.log(`  Relinked:       ${r.relinked_chunks}`);

    if (r.blocked_chunks.length > 0) {
      console.log(`  ${yellow}Blocked:          ${r.blocked_chunks.length}${reset}`);
      console.log('');

      // Print conflict report
      const { formatConflictReport } = await import('./sync/index.js');
      const report = formatConflictReport(r.blocked_chunks);
      console.log(report);
      console.log(`${dim}Non-conflicting chunks imported successfully.${reset}`);
    }
    console.log('');
  } catch (e) {
    console.error(`Failed to connect to daemon: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

async function runSyncResolve(parsed: ParsedArgs): Promise<void> {
  const project = discoverProject(process.cwd());
  if (!project) {
    console.error('No .knowledge-graph/ found. Run `kg init` first.');
    process.exit(1);
  }

  // Parse: kg sync resolve <sync_id> <keep-local|accept-remote>
  // positionalArgs[0] = 'status'|'export'|'import'|'resolve' (subcommand already consumed)
  // After command='sync', positionalArgs = ['resolve', '<sync_id>', '<action>']
  // But the dispatcher already extracted subcommand. So remaining args are:
  const syncId = parsed.positionalArgs[1]; // after subcommand
  const action = parsed.positionalArgs[2];

  if (!syncId || !action) {
    console.error('Usage: kg sync resolve <sync_id> <keep-local|accept-remote>');
    process.exit(1);
  }

  if (action !== 'keep-local' && action !== 'accept-remote') {
    console.error(`Invalid action "${action}". Must be "keep-local" or "accept-remote".`);
    process.exit(1);
  }

  const daemonUrl = await getDaemonUrl(project);
  if (!daemonUrl) {
    console.error('Daemon not running. Start with: kg serve');
    process.exit(1);
  }

  const bold = '\x1b[1m';
  const reset = '\x1b[0m';

  try {
    const res = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'sync_resolve',
        params: { sync_id: syncId, action },
        id: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json() as {
      result?: { sync_id: string; action: string; lifecycle: string; summary: string };
      error?: { message: string };
    };

    if (body.error) {
      console.error(`Error: ${body.error.message}`);
      process.exit(1);
    }

    const r = body.result!;
    console.log(`\n${bold}Sync Resolve${reset}\n`);
    console.log(`  Chunk:     ${r.sync_id}`);
    console.log(`  Summary:   ${r.summary}`);
    console.log(`  Action:    ${r.action}`);
    console.log(`  Lifecycle: ${r.lifecycle}`);
    console.log('');
  } catch (e) {
    console.error(`Failed to connect to daemon: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
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

  case 'status':
    runStatus().catch((e) => {
      console.error('Status failed:', e);
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

  case 'setup-hooks':
    runSetupHooks().catch((e) => {
      console.error('Setup hooks failed:', e);
      process.exit(1);
    });
    break;

  case 'remove-hooks':
    runRemoveHooks().catch((e) => {
      console.error('Remove hooks failed:', e);
      process.exit(1);
    });
    break;

  case 'setup-skills':
    runSetupSkills().catch((e) => {
      console.error('Setup skills failed:', e);
      process.exit(1);
    });
    break;

  case 'remove-skills':
    runRemoveSkills().catch((e) => {
      console.error('Remove skills failed:', e);
      process.exit(1);
    });
    break;

  case 'logs':
    runLogs().catch((e) => {
      console.error('Logs failed:', e);
      process.exit(1);
    });
    break;

  case 'prime':
    runPrime().catch((e) => {
      console.error('Prime failed:', e);
      process.exit(1);
    });
    break;

  case 'list':
    runList(parsed).catch((e) => {
      console.error('List failed:', e);
      process.exit(1);
    });
    break;

  case 'query':
    runQuery(parsed).catch((e) => {
      console.error('Query failed:', e);
      process.exit(1);
    });
    break;

  case 'context':
    runContext().catch(() => process.exit(0));
    break;

  case 'sync': {
    const subcommand = parsed.positionalArgs[0] || '';
    switch (subcommand) {
      case 'status':
        runSyncStatus().catch((e) => {
          console.error('Sync status failed:', e);
          process.exit(1);
        });
        break;
      case 'export':
        runSyncExport(parsed).catch((e) => {
          console.error('Sync export failed:', e);
          process.exit(1);
        });
        break;
      case 'import':
        runSyncImport().catch((e) => {
          console.error('Sync import failed:', e);
          process.exit(1);
        });
        break;
      case 'resolve':
        runSyncResolve(parsed).catch((e) => {
          console.error('Sync resolve failed:', e);
          process.exit(1);
        });
        break;
      default:
        if (subcommand) {
          console.error(`Unknown sync subcommand: "${subcommand}"`);
        } else {
          console.error('Missing sync subcommand.');
        }
        console.error('Available: sync status, sync export [--dry-run], sync import, sync resolve <id> <action>');
        process.exit(1);
    }
    break;
  }

  case '':
    printHelp();
    process.exit(0);

  default:
    console.error(`Unknown command: ${parsed.command}`);
    printHelp();
    process.exit(1);
}
