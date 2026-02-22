declare module 'kuzu' {
  export class Database {
    constructor(
      databasePath?: string,
      bufferManagerSize?: number,
      enableCompression?: boolean,
      readOnly?: boolean,
      maxDBSize?: number,
      autoCheckpoint?: boolean,
      checkpointThreshold?: number
    );
    init(): Promise<void>;
    close(): Promise<void>;
  }

  export class Connection {
    constructor(database: Database, numThreads?: number);
    init(): Promise<void>;
    query(statement: string): Promise<QueryResult>;
    prepare(statement: string): Promise<PreparedStatement>;
    execute(
      preparedStatement: PreparedStatement,
      params?: Record<string, unknown>
    ): Promise<QueryResult>;
    close(): Promise<void>;
    setMaxNumThreadForExec(numThreads: number): void;
    setQueryTimeout(timeoutInMs: number): void;
  }

  export class PreparedStatement {
    isSuccess(): boolean;
    getErrorMessage(): string;
  }

  export class QueryResult {
    resetIterator(): void;
    hasNext(): boolean;
    getNumTuples(): number;
    getNext(): Promise<Record<string, unknown>>;
    getAll(): Promise<Record<string, unknown>[]>;
    getColumnNames(): Promise<string[]>;
    getColumnDataTypes(): Promise<string[]>;
    close(): void;
  }

  export const VERSION: string;
  export const STORAGE_VERSION: number;
}
