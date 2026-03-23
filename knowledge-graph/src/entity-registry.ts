import { readFileSync, writeFileSync, existsSync } from 'fs';
import { log } from './types.js';

/**
 * Entity alias registry — resolves aliases to canonical entity names.
 * Loaded from config at daemon startup, persisted back on new alias registration.
 */
export class EntityAliasRegistry {
  private registry: Map<string, string>; // alias (lowercase) → canonical name
  private configPath: string | null;

  constructor(initial: Record<string, string> = {}, configPath?: string) {
    this.registry = new Map(
      Object.entries(initial).map(([alias, canonical]) => [alias.toLowerCase(), canonical])
    );
    this.configPath = configPath ?? null;
  }

  /** Resolve a name to its canonical form. Case-insensitive alias lookup. */
  resolve(name: string): string {
    return this.registry.get(name.toLowerCase()) ?? name;
  }

  /** Register a new alias → canonical mapping. Returns true if a new alias was added. */
  addAlias(alias: string, canonical: string): boolean {
    const key = alias.toLowerCase();
    if (this.registry.has(key)) return false;
    this.registry.set(key, canonical);
    return true;
  }

  /** Get all aliases as a plain object (for serialization). */
  allAliases(): Record<string, string> {
    return Object.fromEntries(this.registry);
  }

  /** Persist updated registry back to knowledge.json config file. */
  save(): void {
    if (!this.configPath || !existsSync(this.configPath)) return;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const config = JSON.parse(raw);
      if (!config.entityAliases) config.entityAliases = {};
      config.entityAliases.registry = this.allAliases();
      writeFileSync(this.configPath, JSON.stringify(config, null, 2) + '\n');
    } catch (e) {
      log('EntityAliasRegistry: failed to persist aliases:', e);
    }
  }
}
