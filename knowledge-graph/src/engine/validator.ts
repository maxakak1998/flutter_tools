import { CodeRef, CODE_RELATION_TABLE_MAP, log } from '../types.js';

// Which entity_types are typical for each layer
const LAYER_TYPICAL_TYPES: Record<string, string[]> = {
  domain:       ['interface', 'use-case', 'class', 'enum', 'type-alias', 'method', 'file'],
  data:         ['repository', 'class', 'factory', 'interface', 'method', 'file', 'enum'],
  presentation: ['cubit', 'widget', 'screen', 'route', 'method', 'file', 'enum'],
  core:         ['class', 'function', 'constant', 'extension', 'mixin', 'inject-module', 'method', 'file', 'enum'],
  test:         ['test-file', 'function', 'class', 'method', 'file'],
};

export function validateCodeRefs(refs: CodeRef[]): string[] {
  const warnings: string[] = [];

  for (const ref of refs) {
    // Warn: entity_type unusual for the given layer
    if (ref.layer) {
      const typical = LAYER_TYPICAL_TYPES[ref.layer];
      if (typical && !typical.includes(ref.entity_type)) {
        warnings.push(
          `entity_type "${ref.entity_type}" is unusual for layer "${ref.layer}". ` +
          `Typical for ${ref.layer}: ${typical.join(', ')}`
        );
      }
    }

    // Warn: relation won't create a Chunk→CodeEntity edge
    if (!CODE_RELATION_TABLE_MAP[ref.relation]) {
      warnings.push(
        `relation "${ref.relation}" does not create a Chunk→CodeEntity edge. ` +
        `Use implemented_by, tested_by, or demonstrated_in for graph links.`
      );
    }
  }

  // Log warnings to stderr for server-side visibility
  for (const w of warnings) log('Validation warning:', w);

  return warnings;
}
