// Lossless saving (#40): apply only the user's edits onto the original file.
//
//   original  – the file as loaded (editor-normalized line endings)
//   base      – what Muya serializes for that file before any edit
//   edited    – what Muya serializes now
//
// base→edited are the user's edits; base→original are Muya's formatting
// normalizations, reversed. A three-way merge keeps the original text for
// every line the user didn't touch; edited lines come out in Muya's style.
import { diffArrays } from 'diff';
import { diff3Merge } from 'node-diff3';

// Map each base line to the original line(s) it came from. Where Muya
// rewrote k original lines as m base lines, lines pair up in order and the
// last base line of the run takes any extra original lines (e.g. 3 blank
// lines collapsed into 1). Original lines with no base counterpart become a
// prefix of the next base line.
function mapBaseToOurs(base: string[], ours: string[]) {
  const oursFor: string[][] = base.map(() => []);
  const prefix: string[][] = Array.from({ length: base.length + 1 }, () => []);
  const parts = diffArrays(base, ours);
  let bi = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part.added && !part.removed) {
      for (const line of part.value) oursFor[bi++].push(line);
    } else if (part.removed) {
      const next = parts[p + 1];
      const added = next?.added ? next.value : [];
      if (next?.added) p++;
      const k = part.value.length;
      for (let j = 0; j < k; j++) {
        if (j < k - 1) {
          if (j < added.length) oursFor[bi].push(added[j]);
        } else {
          oursFor[bi].push(...added.slice(j));
        }
        bi++;
      }
    } else {
      prefix[bi].push(...part.value);
    }
  }
  return { oursFor, prefix };
}

function resolveConflict(ours: string[], base: string[], theirs: string[]): string[] {
  const { oursFor, prefix } = mapBaseToOurs(base, ours);
  const out: string[] = [];
  let bi = 0;
  for (const part of diffArrays(base, theirs)) {
    if (part.added) {
      out.push(...part.value);
    } else if (part.removed) {
      // The user changed or deleted these lines. Original-only lines in front
      // of them (e.g. extra blank lines) are formatting; keep them.
      for (let k = 0; k < part.value.length; k++, bi++) out.push(...prefix[bi]);
    } else {
      for (let k = 0; k < part.value.length; k++, bi++) out.push(...prefix[bi], ...oursFor[bi]);
    }
  }
  if (bi === base.length) out.push(...prefix[base.length]);
  return out;
}

export function losslessMerge(original: string, base: string, edited: string): string {
  if (original === base) return edited;
  if (base === edited) return original;
  const chunks = diff3Merge(original.split('\n'), base.split('\n'), edited.split('\n'), { excludeFalseConflicts: true });
  const lines: string[] = [];
  for (const c of chunks) {
    if ('ok' in c && c.ok) lines.push(...c.ok);
    else if ('conflict' in c && c.conflict) lines.push(...resolveConflict(c.conflict.a, c.conflict.o, c.conflict.b));
  }
  return lines.join('\n');
}
