/**
 * detectLatex.ts
 * Detects LaTeX expressions in plain text.
 * Handles: $...$, $$...$$, \(...\), \[...\]
 * Skips escaped \$ signs.
 */

export interface LatexMatch {
  /** LaTeX content without delimiters */
  latex: string;
  /** Full match including delimiters */
  raw: string;
  /** Start index in source string */
  start: number;
  /** End index (exclusive) in source string */
  end: number;
  /** true for $$...$$ or \[...\] */
  displayMode: boolean;
}

/**
 * Detect all LaTeX expressions in a plain text string.
 * Returns matches sorted by position.
 */
export function detectLatexInText(text: string): LatexMatch[] {
  if (!text || text.length < 2) return [];

  const matches: LatexMatch[] = [];
  // Track matched byte ranges to prevent overlaps
  const used = new Uint8Array(text.length);

  function addMatch(start: number, end: number, raw: string, latex: string, displayMode: boolean) {
    for (let i = start; i < end; i++) {
      if (used[i]) return; // overlaps an existing match
    }
    for (let i = start; i < end; i++) used[i] = 1;
    const trimmed = latex.trim();
    if (trimmed.length > 0) {
      matches.push({ latex: trimmed, raw, start, end, displayMode });
    }
  }

  // --- Pass 1: $$...$$ (display) ---
  {
    const re = /\$\$([\s\S]*?)\$\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      addMatch(m.index, m.index + m[0].length, m[0], m[1], true);
    }
  }

  // --- Pass 2: \[...\] (display) ---
  {
    const re = /\\\[([\s\S]*?)\\\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      addMatch(m.index, m.index + m[0].length, m[0], m[1], true);
    }
  }

  // --- Pass 3: \(...\) (inline) ---
  {
    const re = /\\\(([\s\S]*?)\\\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      addMatch(m.index, m.index + m[0].length, m[0], m[1], false);
    }
  }

  // --- Pass 4: \$...$ (inline, escaped opening dollar) ---
  // Some source docs contain a literal backslash before the opening delimiter.
  // Treat this as math delimiters rather than plain text.
  {
    const re = /\\\$([\s\S]*?)\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      addMatch(m.index, m.index + m[0].length, m[0], m[1], false);
    }
  }

  // --- Pass 5: $...$ (inline, single dollar) ---
  // Must not be preceded by \ (escaped), must not be $$
  {
    let i = 0;
    while (i < text.length) {
      if (text[i] === '$') {
        // Skip \$ (escaped dollar)
        if (i > 0 && text[i - 1] === '\\') { i++; continue; }
        // Skip $$ (already handled above, and those positions are marked)
        if (used[i]) { i++; continue; }

        const start = i;
        i++; // move past opening $
        let content = '';
        let found = false;

        while (i < text.length) {
          if (text[i] === '\\') {
            // Consume escaped character
            content += text[i];
            i++;
            if (i < text.length) {
              content += text[i];
              i++;
            }
            continue;
          }
          if (text[i] === '$') {
            // Closing $
            found = true;
            i++; // move past closing $
            break;
          }
          content += text[i];
          i++;
        }

        if (found && content.trim().length > 0) {
          const raw = text.slice(start, i);
          addMatch(start, i, raw, content, false);
        }
        continue;
      }
      i++;
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}

/** Quick check — cheaper than full detection */
export function containsLatex(text: string): boolean {
  // Fast pre-check with simple indexOf before running full regex
  return (
    text.includes('$') ||
    text.includes('\\(') ||
    text.includes('\\[')
  );
}
