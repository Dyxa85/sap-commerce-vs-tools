import { describe, expect, it } from 'vitest';
import { ChangeIndex, letterOf } from '../src/changes/model.js';

describe('changes', () => {
  it('maps the statuses of the Git extension to letters', () => {
    expect(letterOf(5)).toBe('M');
    expect(letterOf(0)).toBe('M');
    expect(letterOf(1)).toBe('A');
    expect(letterOf(6)).toBe('D');
    expect(letterOf(7)).toBe('U');
    expect(letterOf(3)).toBe('R');
    expect(letterOf(18)).toBe('C');
  });

  it('knows changed files and the folders that contain them, up to the repository', () => {
    const index = new ChangeIndex(
      [
        { path: '/r/repo/a/b/c.ts', letter: 'M' },
        { path: '/r/repo/a/d.ts', letter: 'U' },
        { path: '/r/repo/a/d.ts', letter: 'A' },
      ],
      ['/r/repo'],
    );
    expect(index.size).toBe(2);
    expect(index.fileLetter('/r/repo/a/b/c.ts')).toBe('M');
    expect(index.fileLetter('/r/repo/a/d.ts')).toBe('A'); // the stronger status wins
    expect(index.insideFolder('/r/repo/a')).toBe(2);
    expect(index.insideFolder('/r/repo/a/b')).toBe(1);
    expect(index.insideFolder('/r/repo')).toBe(2);
    expect(index.insideFolder('/r')).toBe(0); // stops at the repository root
    expect(index.insideFolder('/r/repo/other')).toBe(0);
  });
});
