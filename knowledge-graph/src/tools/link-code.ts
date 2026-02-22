import { randomUUID } from 'crypto';
import { KuzuStorage } from '../storage/kuzu.js';
import { Embedder } from '../engine/embedder.js';
import { CodeRef, CODE_RELATION_TABLE_MAP, log } from '../types.js';
import { validateCodeRefs } from '../engine/validator.js';

interface LinkCodeResult {
  chunk_id: string;
  linked_entities: Array<{
    code_entity_id: string;
    name: string;
    relation: string;
  }>;
  warnings: string[];
}

export async function handleLinkCode(
  storage: KuzuStorage,
  embedder: Embedder,
  chunkId: string,
  codeEntities: CodeRef[]
): Promise<LinkCodeResult> {
  // Verify chunk exists
  const chunk = await storage.getChunk(chunkId);
  if (!chunk) throw new Error(`Chunk not found: ${chunkId}`);

  const warnings = validateCodeRefs(codeEntities);
  const linkedEntities: LinkCodeResult['linked_entities'] = [];

  for (const entity of codeEntities) {
    try {
      const codeId = `code-${randomUUID().slice(0, 8)}`;
      const codeEmbedding = await embedder.embed(
        `${entity.name} ${entity.entity_type} ${entity.file_path}`
      );

      await storage.createCodeEntity({
        id: codeId,
        name: entity.name.trim(),
        entity_type: entity.entity_type,
        file_path: entity.file_path.trim(),
        line_start: entity.line_start ?? null,
        line_end: null,
        signature: entity.signature?.trim() ?? null,
        layer: entity.layer ?? null,
        feature: entity.feature ?? null,
        embedding: codeEmbedding,
      });

      // Determine relationship table
      const relTable = CODE_RELATION_TABLE_MAP[entity.relation];
      if (relTable) {
        // Knowledge → Code relationships
        const props: Record<string, string> = {};
        if (entity.description) props.description = entity.description;
        await storage.createRelation(
          chunkId,
          codeId,
          relTable,
          'Chunk',
          'CodeEntity',
          Object.keys(props).length > 0 ? props : undefined
        );
      }

      linkedEntities.push({
        code_entity_id: codeId,
        name: entity.name,
        relation: entity.relation,
      });
    } catch (e) {
      log('Failed to link code entity:', entity.name, e);
    }
  }

  log('Linked', linkedEntities.length, 'code entities to chunk', chunkId);
  return { chunk_id: chunkId, linked_entities: linkedEntities, warnings };
}
