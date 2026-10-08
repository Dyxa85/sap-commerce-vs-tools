export type HistoryKind = 'flexsearch' | 'sql' | 'groovy' | 'impex';

export interface HistoryEntry {
  kind: HistoryKind;
  text: string;
  connection: string;
  at: number;
}

/** Subset of vscode.Memento so the class stays testable without VS Code. */
export interface KeyValueStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

const KEY = 'sapcommerce.history';

export class History {
  constructor(
    private readonly store: KeyValueStore,
    private readonly limit = 100,
  ) {}

  list(kind?: HistoryKind): HistoryEntry[] {
    const all = this.store.get<HistoryEntry[]>(KEY, []);
    return kind ? all.filter((e) => e.kind === kind) : all;
  }

  /** Newest first; identical consecutive entries (same kind + text) are collapsed. */
  async add(entry: HistoryEntry): Promise<void> {
    const all = this.list();
    const rest = all.filter((e) => !(e.kind === entry.kind && e.text === entry.text));
    await this.store.update(KEY, [entry, ...rest].slice(0, this.limit));
  }

  async clear(): Promise<void> {
    await this.store.update(KEY, []);
  }
}
