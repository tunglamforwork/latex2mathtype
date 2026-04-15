/**
 * dedupe.ts
 * Deduplicates LaTeX expressions before conversion.
 * Avoids redundant work when the same equation appears many times.
 */

import { LatexMatch } from './detectLatex';

/** Unique LaTeX strings with their display mode flag */
export interface UniqueLatex {
  latex: string;
  displayMode: boolean;
  /** How many times this exact (latex, displayMode) pair appeared */
  count: number;
}

/**
 * Given a flat list of LaTeX matches (potentially many paragraphs),
 * return deduplicated entries sorted by frequency descending.
 */
export function deduplicateLatex(matches: LatexMatch[]): UniqueLatex[] {
  // Key: "0:latex" or "1:latex" (displayMode:content)
  const map = new Map<string, UniqueLatex>();

  for (const m of matches) {
    const key = `${m.displayMode ? 1 : 0}:${m.latex}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { latex: m.latex, displayMode: m.displayMode, count: 1 });
    }
  }

  // Sort by count descending so workers get the most-used equations first
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * Split a list of unique equations into N roughly equal batches.
 * Used to distribute work across worker threads.
 */
export function splitIntoBatches<T>(items: T[], n: number): T[][] {
  if (n <= 0 || items.length === 0) return [items];
  const size = Math.ceil(items.length / n);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
