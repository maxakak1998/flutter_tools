import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { log } from './types.js';
import type { StorageBackend } from './storage/interface.js';

// ============================================================
// Config schema
// ============================================================

export interface KnowledgeConfig {
  storage: {
    backend: StorageBackend;
  };
  db: {
    path: string;
  };
  ollama: {
    url: string;
    model: string;
  };
  search: {
    similarityThreshold: number;
    autoLinkTopK: number;
    crossDomainThreshold: number;
  };
  cache: {
    embeddingCacheSize: number;
  };
  dedup: {
    similarityThreshold: number;
  };
  learning: {
    autoPromoteConfidence: number;
    autoPromoteValidations: number;
    confirmationBoost: number;
    refutationPenalty: number;
    confidenceSearchWeight: number;
    hypothesisInitialConfidence: number;
    decayRates: Record<string, number>;
  };
  domains: {
    canonical: string[];
    aliases: Record<string, string>;
  };
  briefing: {
    topDomains: number;
    recentDays: number;
  };
  logging: {
    level: string;
    maxFileSize: number;
    maxFiles: number;
  };
  operational: {
    initialScore: number;
    refutedTtlDays: number;
    draftSkillMinEntries: number;
  };
  entityAliases: {
    registry: Record<string, string>;  // alias (lowercase) → canonical name
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
  storage: {
    backend: 'kuzu' as StorageBackend,
  },
  db: {
    path: join(CONFIG_DIR, 'data', 'knowledge'),
  },
  ollama: {
    url: 'http://localhost:11434',
    model: 'bge-m3',
  },
  search: {
    similarityThreshold: 0.82,
    autoLinkTopK: 5,
    crossDomainThreshold: 0.68,
  },
  cache: {
    embeddingCacheSize: 10_000,
  },
  dedup: {
    similarityThreshold: 0.88,
  },
  learning: {
    autoPromoteConfidence: 0.85,
    autoPromoteValidations: 3,
    confirmationBoost: 0.25,
    refutationPenalty: 0.15,
    confidenceSearchWeight: 0.1,
    hypothesisInitialConfidence: 0.3,
    decayRates: {
      default: 0.95,
      fact: 1.0,
      rule: 1.0,
      insight: 0.95,
      question: 0.90,
      workflow: 0.98,
    },
  },
  domains: { canonical: [], aliases: {} },
  briefing: { topDomains: 10, recentDays: 7 },
  logging: { level: 'info', maxFileSize: 5 * 1024 * 1024, maxFiles: 3 },
  operational: { initialScore: 5, refutedTtlDays: 14, draftSkillMinEntries: 10 },
  entityAliases: { registry: {} },
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
    storage: {
      backend: (overrides.storage?.backend ?? defaults.storage.backend) as StorageBackend,
    },
    db: {
      path: expandTilde(overrides.db?.path ?? defaults.db.path),
    },
    ollama: {
      url: overrides.ollama?.url ?? defaults.ollama.url,
      model: overrides.ollama?.model ?? defaults.ollama.model,
    },
    search: {
      similarityThreshold:
        overrides.search?.similarityThreshold ?? defaults.search.similarityThreshold,
      autoLinkTopK: overrides.search?.autoLinkTopK ?? defaults.search.autoLinkTopK,
      crossDomainThreshold:
        overrides.search?.crossDomainThreshold ?? defaults.search.crossDomainThreshold,
    },
    cache: {
      embeddingCacheSize:
        overrides.cache?.embeddingCacheSize ?? defaults.cache.embeddingCacheSize,
    },
    dedup: {
      similarityThreshold:
        overrides.dedup?.similarityThreshold ?? defaults.dedup.similarityThreshold,
    },
    learning: {
      autoPromoteConfidence:
        overrides.learning?.autoPromoteConfidence ?? defaults.learning.autoPromoteConfidence,
      autoPromoteValidations:
        overrides.learning?.autoPromoteValidations ?? defaults.learning.autoPromoteValidations,
      confirmationBoost:
        overrides.learning?.confirmationBoost ?? defaults.learning.confirmationBoost,
      refutationPenalty:
        overrides.learning?.refutationPenalty ?? defaults.learning.refutationPenalty,
      confidenceSearchWeight:
        overrides.learning?.confidenceSearchWeight ?? defaults.learning.confidenceSearchWeight,
      hypothesisInitialConfidence:
        overrides.learning?.hypothesisInitialConfidence ?? defaults.learning.hypothesisInitialConfidence,
      decayRates: Object.fromEntries(
        Object.entries({
          ...defaults.learning.decayRates,
          ...overrides.learning?.decayRates,
        }).filter((entry): entry is [string, number] => entry[1] !== undefined),
      ),
    },
    domains: {
      canonical: (overrides.domains?.canonical?.filter((value): value is string => value !== undefined) ?? defaults.domains.canonical),
      aliases: { ...defaults.domains.aliases, ...(overrides.domains?.aliases as Record<string, string> | undefined) },
    },
    briefing: {
      topDomains: overrides.briefing?.topDomains ?? defaults.briefing.topDomains,
      recentDays: overrides.briefing?.recentDays ?? defaults.briefing.recentDays,
    },
    logging: {
      level: overrides.logging?.level ?? defaults.logging.level,
      maxFileSize: overrides.logging?.maxFileSize ?? defaults.logging.maxFileSize,
      maxFiles: overrides.logging?.maxFiles ?? defaults.logging.maxFiles,
    },
    operational: {
      initialScore: overrides.operational?.initialScore ?? defaults.operational.initialScore,
      refutedTtlDays: overrides.operational?.refutedTtlDays ?? defaults.operational.refutedTtlDays,
      draftSkillMinEntries: overrides.operational?.draftSkillMinEntries ?? defaults.operational.draftSkillMinEntries,
    },
    entityAliases: {
      registry: {
        ...defaults.entityAliases.registry,
        ...(overrides.entityAliases?.registry as Record<string, string> | undefined),
      },
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
    storage: {
      backend: DEFAULT_CONFIG.storage.backend,
    },
    db: {
      path: '~/.knowledge-graph/data/knowledge',
    },
    ollama: {
      url: DEFAULT_CONFIG.ollama.url,
      model: DEFAULT_CONFIG.ollama.model,
    },
    search: {
      similarityThreshold: DEFAULT_CONFIG.search.similarityThreshold,
      autoLinkTopK: DEFAULT_CONFIG.search.autoLinkTopK,
      crossDomainThreshold: DEFAULT_CONFIG.search.crossDomainThreshold,
    },
    cache: {
      embeddingCacheSize: DEFAULT_CONFIG.cache.embeddingCacheSize,
    },
    dedup: {
      similarityThreshold: DEFAULT_CONFIG.dedup.similarityThreshold,
    },
    learning: {
      autoPromoteConfidence: DEFAULT_CONFIG.learning.autoPromoteConfidence,
      autoPromoteValidations: DEFAULT_CONFIG.learning.autoPromoteValidations,
      confirmationBoost: DEFAULT_CONFIG.learning.confirmationBoost,
      refutationPenalty: DEFAULT_CONFIG.learning.refutationPenalty,
      confidenceSearchWeight: DEFAULT_CONFIG.learning.confidenceSearchWeight,
      hypothesisInitialConfidence: DEFAULT_CONFIG.learning.hypothesisInitialConfidence,
      decayRates: DEFAULT_CONFIG.learning.decayRates,
    },
    domains: DEFAULT_CONFIG.domains,
    briefing: DEFAULT_CONFIG.briefing,
    logging: DEFAULT_CONFIG.logging,
    operational: DEFAULT_CONFIG.operational,
    entityAliases: DEFAULT_CONFIG.entityAliases,
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(readableConfig, null, 2) + '\n');
  return CONFIG_PATH;
}

// ============================================================
// Apply CLI / env var overrides on top of loaded config
// Priority: CLI flags > env vars > knowledge.json > defaults
// ============================================================

export interface ConfigOverrides {
  storageBackend?: StorageBackend;
  dbPath?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
}

export function applyOverrides(
  config: KnowledgeConfig,
  overrides: ConfigOverrides,
): KnowledgeConfig {
  return {
    storage: {
      backend: overrides.storageBackend ?? config.storage.backend,
    },
    db: {
      path: overrides.dbPath ? expandTilde(overrides.dbPath) : config.db.path,
    },
    ollama: {
      url: overrides.ollamaUrl ?? config.ollama.url,
      model: overrides.ollamaModel ?? config.ollama.model,
    },
    search: config.search,
    cache: config.cache,
    dedup: config.dedup,
    learning: config.learning,
    domains: config.domains,
    briefing: config.briefing,
    logging: config.logging,
    operational: config.operational,
    entityAliases: config.entityAliases,
  };
}
