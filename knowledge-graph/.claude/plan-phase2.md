# Phase 2: Add Storage Backend Config and CLI Flag

## Overview

Add `storage: { backend: StorageBackend }` to `KnowledgeConfig` with default `'surreal'`. Wire through CLI flag, env var, config file, and daemon.

## Changes

### 1. `src/config.ts` — Add storage config section

**KnowledgeConfig interface** — Add new `storage` section:
```typescript
export interface KnowledgeConfig {
  storage: {
    backend: StorageBackend;  // import from storage/interface.ts
  };
  db: { ... };
  // ... existing fields
}
```

**DEFAULT_CONFIG** — Add:
```typescript
storage: {
  backend: 'surreal' as StorageBackend,
},
```

**mergeWithDefaults()** — Add storage merge:
```typescript
storage: {
  backend: (overrides.storage?.backend ?? defaults.storage.backend) as StorageBackend,
},
```

**ConfigOverrides** — Add:
```typescript
export interface ConfigOverrides {
  storageBackend?: StorageBackend;
  dbPath?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
}
```

**applyOverrides()** — Add:
```typescript
storage: {
  backend: overrides.storageBackend ?? config.storage.backend,
},
```

**saveDefaultConfig()** — Add `storage` section to the readable config written to disk:
```typescript
storage: {
  backend: DEFAULT_CONFIG.storage.backend,
},
```

**Import** — Add `StorageBackend` import from `./storage/interface.js`.

### 2. `src/cli.ts` — Add `--storage` CLI flag

**ParsedArgs** — Add:
```typescript
storageBackend?: string;
```

**parseArgs()** — Add case:
```typescript
case '--storage':
  storageBackend = rawArgs[++i];
  break;
```

**resolveConfig()** — Add to overrides:
```typescript
storageBackend: (parsed.storageBackend || process.env.KNOWLEDGE_STORAGE_BACKEND || undefined) as StorageBackend | undefined,
```

**printHelp()** — Add to OPTIONS:
```
  --storage <backend>   Storage backend: kuzu or surreal (default: surreal)
```

Add to ENVIRONMENT VARIABLES:
```
  KNOWLEDGE_STORAGE_BACKEND  Storage backend (kuzu or surreal)
```

### 3. `src/core.ts` — Wire config into createStorage

Replace the hardcoded `'kuzu'` with `config.storage.backend`:

```typescript
// Before:
const storage = await createStorage('kuzu', db.path);

// After:
const storage = await createStorage(config.storage.backend, db.path);
```

Add a log line for the storage backend:
```typescript
log(`Storage backend: ${config.storage.backend}`);
```

### 4. Daemon passthrough

The daemon already receives the full `KnowledgeConfig` as JSON via `KG_DAEMON_CONFIG` env var (see `daemon-manager.ts:56-59`). Since we're adding `storage` to `KnowledgeConfig`, it will automatically be serialized and passed through. The daemon deserializes it at `daemon.ts:43` and passes it to `createCore()`. **No daemon changes needed.**

### 5. `package.json` — Install SurrealDB dependencies

```bash
npm install surrealdb @surrealdb/node
```

This adds the packages needed for Phase 3 (SurrealDB storage implementation).

## Resolution Priority Chain

```
CLI --storage flag > KNOWLEDGE_STORAGE_BACKEND env var > knowledge.json storage.backend > default ('surreal')
```

This follows the existing pattern used by `--db-path`, `--ollama-url`, etc.

## Files Modified

| File | Changes |
|------|---------|
| `src/config.ts` | Add `storage` to interface, defaults, merge, overrides, save |
| `src/cli.ts` | Add `--storage` flag, env var, help text |
| `src/core.ts` | Replace hardcoded `'kuzu'` with `config.storage.backend` |
| `package.json` | Install `surrealdb` + `@surrealdb/node` |

## Not Changed

| File | Reason |
|------|--------|
| `src/daemon.ts` | Config passthrough is automatic via JSON serialization |
| `src/daemon-manager.ts` | Already passes full KnowledgeConfig |
| `src/storage/interface.ts` | Already has StorageBackend type + createStorage factory (Phase 1) |
