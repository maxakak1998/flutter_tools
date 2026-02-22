import { readFile } from 'fs/promises';
import { log } from '../types.js';

export async function handleIngest(
  path: string
): Promise<{ content: string; path: string; size: number }> {
  try {
    const content = await readFile(path, 'utf-8');
    const size = content.length;

    if (size > 50000) {
      log(`Warning: File ${path} is ${size} chars. Claude should chunk it into multiple knowledge_store() calls.`);
    }

    return { content, path, size };
  } catch (e) {
    throw new Error(`Failed to read file: ${path} — ${e instanceof Error ? e.message : String(e)}`);
  }
}
