/**
 * Promise-based async mutex for serializing operations.
 *
 * KuzuDB's Node.js binding does not support overlapping async queries
 * on a single Connection. This mutex ensures only one RPC handler
 * executes at a time, preventing connection-level races.
 *
 * FIFO queue: waiters are unblocked in the order they called acquire().
 * Node.js single-threaded guarantee means `locked` and `queue` mutations
 * are atomic (no synchronous data races).
 */
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Pass lock directly to next waiter (stays locked, no gap)
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Number of operations waiting to acquire the lock. */
  get pending(): number {
    return this.queue.length;
  }

  /** Whether the mutex is currently held. */
  get isLocked(): boolean {
    return this.locked;
  }
}
