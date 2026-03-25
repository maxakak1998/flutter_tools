import { IStorage, createStorage } from './storage/interface.js';
import { Embedder } from './engine/embedder.js';
import { Retriever } from './engine/retriever.js';
import { Linker } from './engine/linker.js';
import { EventBus } from './dashboard/events.js';
import { KnowledgeConfig } from './config.js';
import { EntityAliasRegistry } from './entity-registry.js';
import { log } from './types.js';

export interface CoreComponents {
  storage: IStorage;
  embedder: Embedder;
  retriever: Retriever;
  linker: Linker;
  eventBus: EventBus;
  config: KnowledgeConfig;
  entityRegistry: EntityAliasRegistry;
}

/**
 * Create and initialize all core engine components.
 * Used by the daemon process.
 */
export async function createCore(config: KnowledgeConfig, configPath?: string): Promise<CoreComponents> {
  const { db, ollama, search, cache } = config;

  const storage = await createStorage(config.storage.backend, db.path);
  const embedder = new Embedder(ollama.url, ollama.model, cache.embeddingCacheSize);
  const retriever = new Retriever(storage, embedder, {
    confidenceSearchWeight: config.learning.confidenceSearchWeight,
    decayRates: config.learning.decayRates,
  });
  const linker = new Linker(storage, embedder, search.similarityThreshold, search.autoLinkTopK, search.crossDomainThreshold);
  const eventBus = new EventBus();
  const entityRegistry = new EntityAliasRegistry(
    config.entityAliases.registry,
    configPath,
  );

  log('Starting knowledge-graph MCP server...');
  log(`Storage backend: ${config.storage.backend}`);
  log(`DB path: ${db.path}`);
  log(`Ollama: ${ollama.url} (model: ${ollama.model})`);

  const health = await embedder.healthCheck();
  if (!health.ok) {
    log('WARNING:', health.error);
    log('Server starting anyway — embedding will fail until Ollama is ready.');
  } else {
    log('Ollama health check passed');
  }

  const aliasCount = Object.keys(config.entityAliases.registry).length;
  if (aliasCount > 0) {
    log(`Entity alias registry loaded: ${aliasCount} aliases`);
  }

  return { storage, embedder, retriever, linker, eventBus, config, entityRegistry };
}
