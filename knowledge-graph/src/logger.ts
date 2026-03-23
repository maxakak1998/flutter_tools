import { appendFileSync, statSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

// No imports from types.ts — avoids circular dependency.
// This module is injected into types.ts via setFileLogger().

export enum LogLevel { debug = 0, info = 1, warn = 2, error = 3 }

export interface LogEntry {
  ts: string;
  level: string;
  source: string;
  msg: string;
  data?: unknown;
}

export function parseLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'debug': return LogLevel.debug;
    case 'warn': return LogLevel.warn;
    case 'error': return LogLevel.error;
    default: return LogLevel.info;
  }
}

const LEVEL_NAMES: Record<number, string> = {
  [LogLevel.debug]: 'debug',
  [LogLevel.info]: 'info',
  [LogLevel.warn]: 'warn',
  [LogLevel.error]: 'error',
};

export class FileLogger {
  private logFile: string;
  private maxBytes: number;
  private maxFiles: number;
  private minLevel: LogLevel;

  constructor(
    private logDir: string,
    opts?: { maxBytes?: number; maxFiles?: number; minLevel?: LogLevel },
  ) {
    this.logFile = join(logDir, 'daemon.log');
    this.maxBytes = opts?.maxBytes ?? 5 * 1024 * 1024;
    this.maxFiles = opts?.maxFiles ?? 3;
    this.minLevel = opts?.minLevel ?? LogLevel.info;
  }

  init(): void {
    mkdirSync(this.logDir, { recursive: true });
  }

  write(level: LogLevel, source: string, msg: string, data?: unknown): void {
    if (level < this.minLevel) return;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: LEVEL_NAMES[level] ?? 'info',
      source,
      msg,
      ...(data !== undefined ? { data } : {}),
    };
    try {
      appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
      this.maybeRotate();
    } catch { /* don't throw on log failure */ }
  }

  debug(source: string, msg: string, data?: unknown): void { this.write(LogLevel.debug, source, msg, data); }
  info(source: string, msg: string, data?: unknown): void { this.write(LogLevel.info, source, msg, data); }
  warn(source: string, msg: string, data?: unknown): void { this.write(LogLevel.warn, source, msg, data); }
  error(source: string, msg: string, data?: unknown): void { this.write(LogLevel.error, source, msg, data); }

  getStats(): { path: string; sizeBytes: number; rotatedFiles: number } {
    let sizeBytes = 0;
    try { sizeBytes = statSync(this.logFile).size; } catch { /* missing */ }
    let rotatedFiles = 0;
    for (let i = 1; i <= this.maxFiles; i++) {
      if (existsSync(this.logFile + '.' + i)) rotatedFiles++;
    }
    return { path: this.logFile, sizeBytes, rotatedFiles };
  }

  private maybeRotate(): void {
    try {
      const size = statSync(this.logFile).size;
      if (size < this.maxBytes) return;
    } catch { return; }

    // Rotate: daemon.log.3 → delete, daemon.log.2 → .3, daemon.log.1 → .2, daemon.log → .1
    for (let i = this.maxFiles; i >= 1; i--) {
      const src = i === 1 ? this.logFile : this.logFile + '.' + (i - 1);
      const dst = this.logFile + '.' + i;
      if (i === this.maxFiles && existsSync(dst)) {
        try { unlinkSync(dst); } catch { /* ignore */ }
      }
      if (existsSync(src)) {
        try { renameSync(src, dst); } catch { /* ignore */ }
      }
    }
  }
}
