import { writeFileSync, readFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { log } from './types.js';

export interface CacheManager {
  write(filename: string, data: unknown): void;
  read<T>(filename: string): T | null;
  ensureDir(): void;
}

export function createCacheManager(kgDir: string): CacheManager {
  const cacheDir = join(kgDir, 'cache');

  return {
    ensureDir() {
      mkdirSync(cacheDir, { recursive: true });
    },
    write(filename: string, data: unknown) {
      const filePath = join(cacheDir, filename);
      const tmpPath = filePath + '.tmp';
      try {
        writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        renameSync(tmpPath, filePath);
      } catch (e) {
        log('CacheManager: write error:', filename, e);
      }
    },
    read<T>(filename: string): T | null {
      const filePath = join(cacheDir, filename);
      if (!existsSync(filePath)) return null;
      try {
        return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
      } catch {
        return null;
      }
    },
  };
}
