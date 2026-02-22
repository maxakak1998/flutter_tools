import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { log } from './types.js';

// ============================================================
// Config schema
// ============================================================

export interface KnowledgeConfig {
  db: {
    path: string;
  };
  ollama: {
    url: string;
    model: string;
  };
  dashboard: {
    enabled: boolean;
    port: number;
  };
  search: {
    similarityThreshold: number;
    defaultLimit: number;
    autoLinkTopK: number;
  };
  limits: {
    maxContentLength: number;
    maxSummaryLength: number;
  };
  cache: {
    embeddingCacheSize: number;
  };
  dedup: {
    similarityThreshold: number;
  };
}

// ============================================================
// Paths
// ============================================================

export const CONFIG_DIR = join(homedir(), '.knowledge-graph');
export const CONFIG_PATH = join(CONFIG_DIR, 'knowledge.json');

// ============================================================
// Defaults
// ============================================================

export const DEFAULT_CONFIG: KnowledgeConfig = {
  db: {
    path: join(CONFIG_DIR, 'data', 'knowledge'),
  },
  ollama: {
    url: 'http://localhost:11434',
    model: 'bge-m3',
  },
  dashboard: {
    enabled: true,
    port: 3333,
  },
  search: {
    similarityThreshold: 0.82,
    defaultLimit: 10,
    autoLinkTopK: 5,
  },
  limits: {
    maxContentLength: 5000,
    maxSummaryLength: 200,
  },
  cache: {
    embeddingCacheSize: 10_000,
  },
  dedup: {
    similarityThreshold: 0.95,
  },
};

// ============================================================
// Tilde expansion
// ============================================================

function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1));
  }
  return p;
}

// ============================================================
// Deep partial type
// ============================================================

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ============================================================
// Merge user config with defaults (fills missing fields)
// ============================================================

function mergeWithDefaults(
  defaults: KnowledgeConfig,
  overrides: DeepPartial<KnowledgeConfig>,
): KnowledgeConfig {
  return {
    db: {
      path: expandTilde(overrides.db?.path ?? defaults.db.path),
    },
    ollama: {
      url: overrides.ollama?.url ?? defaults.ollama.url,
      model: overrides.ollama?.model ?? defaults.ollama.model,
    },
    dashboard: {
      enabled: overrides.dashboard?.enabled ?? defaults.dashboard.enabled,
      port: overrides.dashboard?.port ?? defaults.dashboard.port,
    },
    search: {
      similarityThreshold:
        overrides.search?.similarityThreshold ?? defaults.search.similarityThreshold,
      defaultLimit: overrides.search?.defaultLimit ?? defaults.search.defaultLimit,
      autoLinkTopK: overrides.search?.autoLinkTopK ?? defaults.search.autoLinkTopK,
    },
    limits: {
      maxContentLength: overrides.limits?.maxContentLength ?? defaults.limits.maxContentLength,
      maxSummaryLength: overrides.limits?.maxSummaryLength ?? defaults.limits.maxSummaryLength,
    },
    cache: {
      embeddingCacheSize:
        overrides.cache?.embeddingCacheSize ?? defaults.cache.embeddingCacheSize,
    },
    dedup: {
      similarityThreshold:
        overrides.dedup?.similarityThreshold ?? defaults.dedup.similarityThreshold,
    },
  };
}

// ============================================================
// Load config from ~/.knowledge-graph/knowledge.json
// ============================================================

export function loadConfig(): KnowledgeConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as DeepPartial<KnowledgeConfig>;
    return mergeWithDefaults(DEFAULT_CONFIG, parsed);
  } catch (e) {
    log(`Warning: Could not parse ${CONFIG_PATH}, using defaults:`, e);
    return { ...DEFAULT_CONFIG };
  }
}

// ============================================================
// Save default config (creates file if missing)
// ============================================================

export function saveDefaultConfig(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });

  if (existsSync(CONFIG_PATH)) {
    return CONFIG_PATH;
  }

  // Write with tilde paths for readability (expanded at load time)
  const readableConfig = {
    db: {
      path: '~/.knowledge-graph/data/knowledge',
    },
    ollama: {
      url: DEFAULT_CONFIG.ollama.url,
      model: DEFAULT_CONFIG.ollama.model,
    },
    dashboard: {
      enabled: DEFAULT_CONFIG.dashboard.enabled,
      port: DEFAULT_CONFIG.dashboard.port,
    },
    search: {
      similarityThreshold: DEFAULT_CONFIG.search.similarityThreshold,
      defaultLimit: DEFAULT_CONFIG.search.defaultLimit,
      autoLinkTopK: DEFAULT_CONFIG.search.autoLinkTopK,
    },
    limits: {
      maxContentLength: DEFAULT_CONFIG.limits.maxContentLength,
      maxSummaryLength: DEFAULT_CONFIG.limits.maxSummaryLength,
    },
    cache: {
      embeddingCacheSize: DEFAULT_CONFIG.cache.embeddingCacheSize,
    },
    dedup: {
      similarityThreshold: DEFAULT_CONFIG.dedup.similarityThreshold,
    },
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(readableConfig, null, 2) + '\n');
  return CONFIG_PATH;
}

// ============================================================
// Apply CLI / env var overrides on top of loaded config
// Priority: CLI flags > env vars > knowledge.json > defaults
// ============================================================

export interface ConfigOverrides {
  dbPath?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dashboardPort?: number;
  noDashboard?: boolean;
}

export function applyOverrides(
  config: KnowledgeConfig,
  overrides: ConfigOverrides,
): KnowledgeConfig {
  return {
    db: {
      path: overrides.dbPath ? expandTilde(overrides.dbPath) : config.db.path,
    },
    ollama: {
      url: overrides.ollamaUrl ?? config.ollama.url,
      model: overrides.ollamaModel ?? config.ollama.model,
    },
    dashboard: {
      enabled: overrides.noDashboard ? false : config.dashboard.enabled,
      port: overrides.dashboardPort ?? config.dashboard.port,
    },
    search: config.search,
    limits: config.limits,
    cache: config.cache,
    dedup: config.dedup,
  };
}
