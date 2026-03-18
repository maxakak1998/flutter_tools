import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

let cachedVersion: string | null = null;

export function getRuntimeVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = join(currentDir, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
    cachedVersion = typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }

  return cachedVersion;
}
