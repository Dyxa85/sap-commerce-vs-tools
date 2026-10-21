import { dirname, resolve } from 'node:path';

export type ChangeLetter = 'M' | 'A' | 'D' | 'U' | 'R' | 'C';

export interface Change {
  /** Absolute path of the file. */
  path: string;
  letter: ChangeLetter;
}

/** What each letter is called and which colour of the Git extension it borrows. */
export const CHANGE_KINDS: Record<ChangeLetter, { label: string; color: string }> = {
  M: { label: 'Modified', color: 'gitDecoration.modifiedResourceForeground' },
  A: { label: 'Added', color: 'gitDecoration.addedResourceForeground' },
  D: { label: 'Deleted', color: 'gitDecoration.deletedResourceForeground' },
  U: { label: 'Untracked', color: 'gitDecoration.untrackedResourceForeground' },
  R: { label: 'Renamed', color: 'gitDecoration.renamedResourceForeground' },
  C: { label: 'Conflict', color: 'gitDecoration.conflictingResourceForeground' },
};

/** The values of the Git extension's `Status` enum (its API does not export them at run time). */
export function letterOf(status: number): ChangeLetter {
  switch (status) {
    case 1: // index added
    case 9: // intent to add
      return 'A';
    case 2: // index deleted
    case 6: // deleted
      return 'D';
    case 3: // index renamed
    case 10: // intent to rename
      return 'R';
    case 7: // untracked
      return 'U';
    case 12: // conflicts
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
      return 'C';
    default:
      return 'M';
  }
}

const RANK: Record<ChangeLetter, number> = { C: 5, D: 4, A: 3, R: 2, M: 1, U: 0 };

/** Lookup of the changed files and of every folder that contains one. */
export class ChangeIndex {
  private readonly files = new Map<string, ChangeLetter>();
  private readonly folders = new Map<string, number>();

  constructor(changes: readonly Change[], stopAt: readonly string[] = []) {
    const stops = new Set(stopAt.map((s) => resolve(s)));
    for (const change of changes) {
      const path = resolve(change.path);
      const known = this.files.get(path);
      if (known) {
        // staged and unstaged change of one file: the stronger status wins, the folders are counted once
        if (RANK[change.letter] > RANK[known]) this.files.set(path, change.letter);
        continue;
      }
      this.files.set(path, change.letter);
      for (let dir = dirname(path); ; dir = dirname(dir)) {
        this.folders.set(dir, (this.folders.get(dir) ?? 0) + 1);
        if (stops.has(dir) || dirname(dir) === dir) break;
      }
    }
  }

  get size(): number {
    return this.files.size;
  }

  fileLetter(path: string): ChangeLetter | undefined {
    return this.files.get(resolve(path));
  }

  /** Number of changed files below the folder. */
  insideFolder(path: string): number {
    return this.folders.get(resolve(path)) ?? 0;
  }

  paths(): string[] {
    return [...this.files.keys(), ...this.folders.keys()];
  }
}
