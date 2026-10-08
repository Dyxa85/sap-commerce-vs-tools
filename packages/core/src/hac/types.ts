export interface QueryOptions {
  query: string;
  /** Server-side row cap. Default 200. */
  maxCount?: number;
  /** User the query runs as. Default: the login user. */
  user?: string;
  locale?: string;
  dataSource?: string;
  /** Commit mode. Default false (rollback). */
  commit?: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: string[][];
  rowCount: number;
  executionTimeMs: number;
  /** The SQL that was actually executed (FlexibleSearch is translated). */
  query?: string;
  dataSource?: string;
  /** True for raw SQL. */
  raw: boolean;
}

export type ScriptType = 'groovy' | 'beanshell' | 'javascript';

export interface ScriptOptions {
  script: string;
  scriptType?: ScriptType;
  /** Default false (rollback). */
  commit?: boolean;
}

export interface ScriptResult {
  /** Return value, "null" when none. */
  result: string;
  output: string;
  stacktrace: string;
  failed: boolean;
}

export type ImpexValidation = 'IMPORT_STRICT' | 'IMPORT_RELAXED';

export interface ImpexOptions {
  validation?: ImpexValidation;
  encoding?: string;
  maxThreads?: number;
  legacyMode?: boolean;
  enableCodeExecution?: boolean;
  distributedMode?: boolean;
  sldEnabled?: boolean;
}

export interface ImpexResult {
  ok: boolean;
  /** "notice" | "error" | … as reported by the hAC. */
  level: string;
  message: string;
  /** Unresolved lines with error comments (import only), when the hAC reports them. */
  details?: string;
}

export interface PkAnalysis {
  pk: string;
  counterBased: boolean;
  typeCode: number;
  composedTypeCode?: string;
  clusterId: number;
  creationDate?: string;
  hex?: string;
  raw: Record<string, unknown>;
}

export interface LoggerInfo {
  name: string;
  parent?: string;
  level: string;
}
