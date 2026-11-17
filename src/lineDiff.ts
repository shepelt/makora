import { diffLines } from 'diff';

export type Hunk = { line: number; before: string[]; after: string[] };

// Line-level differences between the file as loaded and what saving would
// write, grouped into hunks with the original (1-based) line number.
export function lineHunks(original: string, next: string, maxHunks = 200): { hunks: Hunk[]; changedLines: number } {
  const parts = diffLines(original, next);
  const hunks: Hunk[] = [];
  let line = 1;
  let changedLines = 0;
  let current: Hunk | null = null;
  const split = (v: string) => v.replace(/\n$/, '').split('\n');
  for (const p of parts) {
    const lines = split(p.value);
    if (!p.added && !p.removed) {
      current = null;
      line += lines.length;
      continue;
    }
    if (!current) {
      current = { line, before: [], after: [] };
      if (hunks.length < maxHunks) hunks.push(current);
    }
    if (p.removed) {
      current.before.push(...lines);
      changedLines += lines.length;
      line += lines.length;
    } else {
      current.after.push(...lines);
      if (current.before.length === 0) changedLines += lines.length;
    }
  }
  return { hunks, changedLines };
}
