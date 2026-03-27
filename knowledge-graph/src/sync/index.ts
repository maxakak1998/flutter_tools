// Re-export all sync modules

export {
  SyncChunkFile,
  SyncEdgeFile,
  SyncManifest,
  ImportResult,
  LifecycleConflict,
  computeContentHash,
  computeEdgeHash,
  stableStringify,
} from './format.js';

export {
  exportChunk,
  exportEdge,
  exportChunkToFile,
  removeChunkFile,
  exportAll,
} from './export.js';

export {
  importAll,
} from './import.js';

export {
  detectLifecycleConflict,
  deriveDisplayConfidence,
  formatConflictReport,
} from './merge.js';

export {
  createAutoExporter,
  type AutoExporter,
} from './auto-export.js';

export {
  migrateV1toV2,
  type MigrationResult,
} from './migrate.js';
