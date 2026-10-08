import type { Span } from '../languages/shared/line-index.js';

export type ExtensionCategory = 'platform' | 'modules' | 'custom' | 'other';

export interface ExtensionInfo {
  name: string;
  /** Absolute directory of the extension. */
  dir: string;
  category: ExtensionCategory;
  /** Absolute path of its extensioninfo.xml. */
  infoFile: string;
  version?: string;
  requires: string[];
  coreModule?: { packageRoot?: string; manager?: string; generated?: boolean };
  webModule?: { webRoot?: string };
  /** Entries of `<meta key=… value=…/>`. */
  meta: Record<string, string>;
}

export type ProblemSeverity = 'error' | 'warning' | 'info';

export interface PlatformProblem {
  severity: ProblemSeverity;
  message: string;
  /** File the problem should be shown in. */
  file: string;
  span?: Span;
}

export interface ScanPath {
  /** Directory after variable resolution. */
  dir: string;
  autoload: boolean;
  span: Span;
}

export type LocalEntry =
  { kind: 'name'; name: string; span: Span } | { kind: 'dir'; dir: string; span: Span };

export interface LocalExtensions {
  file: string;
  scanPaths: ScanPath[];
  entries: LocalEntry[];
  problems: PlatformProblem[];
}

export interface PlatformProject {
  /** The `hybris` directory (contains `bin` and `config`). */
  hybrisDir: string;
  binDir: string;
  configDir: string;
  platformDir: string;
  localExtensionsFile?: string;
  local?: LocalExtensions;
  /** Every extension found on the scan paths, by name. */
  available: Map<string, ExtensionInfo>;
  /** Extensions that the platform actually loads, dependencies before dependents. */
  loaded: ExtensionInfo[];
  /** Names requested directly (platform/ext, localextensions.xml). */
  requested: Set<string>;
  problems: PlatformProblem[];
}

export interface DependencyEdge {
  from: string;
  to: string;
}
