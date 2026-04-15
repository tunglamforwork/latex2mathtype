/**
 * replace.ts
 * Replaces LaTeX expressions in document.xml with OMML equations.
 *
 * Algorithm per paragraph:
 *  1. Parse all <w:r> runs, merge text, track positions
 *  2. Detect LaTeX matches in merged text
 *  3. If none, keep paragraph unchanged
 *  4. Otherwise rebuild paragraph: non-LaTeX → <w:r>, LaTeX → <m:oMath>
 */

import { detectLatexInText, LatexMatch } from './detectLatex';
import {
  parseParagraphRuns,
  mergedText,
  rPrAtPos,
  extractPPr,
  extractParaOpenTag,
  buildRun,
  ensureMathNamespace,
} from './parse';

export interface ReplaceStats {
  totalParagraphs: number;
  modifiedParagraphs: number;
  converted: number;
  failed: number;
}

// ── Paragraph-level replacement ────────────────────────────────────────────────

/**
 * Process a single paragraph XML string.
 * Returns { xml, converted, failed }.
 */
function processParagraph(
  paraXml: string,
  cache: Map<string, string>,
): { xml: string; converted: number; failed: number } {
  const segments = parseParagraphRuns(paraXml);
  if (segments.length === 0) return { xml: paraXml, converted: 0, failed: 0 };

  const text = mergedText(segments);
  const matches = detectLatexInText(text);
  if (matches.length === 0) return { xml: paraXml, converted: 0, failed: 0 };

  let converted = 0;
  let failed = 0;

  // Build rebuild: split text into non-LaTeX and LaTeX segments
  const pPr = extractPPr(paraXml);
  const openTag = extractParaOpenTag(paraXml);

  const parts: string[] = [];
  let cursor = 0;

  // Check if entire paragraph is a single display equation
  const isSoleDisplay =
    matches.length === 1 &&
    matches[0].displayMode &&
    text.slice(0, matches[0].start).trim() === '' &&
    text.slice(matches[0].end).trim() === '';

  for (const match of matches) {
    // Text before this match
    if (cursor < match.start) {
      const before = text.slice(cursor, match.start);
      const rPr = rPrAtPos(segments, cursor);
      parts.push(buildRun(rPr, before));
    }

    // LaTeX → OMML
    const omml = cache.get(match.latex);
    if (omml) {
      if (match.displayMode && isSoleDisplay) {
        // Will wrap whole paragraph in oMathPara below
        parts.push(`__DISPLAY_OMML__${omml}__/DISPLAY_OMML__`);
      } else {
        parts.push(omml);
      }
      converted++;
    } else {
      // Conversion failed — keep original raw LaTeX as text
      const rPr = rPrAtPos(segments, match.start);
      parts.push(buildRun(rPr, match.raw));
      failed++;
    }

    cursor = match.end;
  }

  // Text after last match
  if (cursor < text.length) {
    const after = text.slice(cursor);
    const rPr = rPrAtPos(segments, cursor);
    parts.push(buildRun(rPr, after));
  }

  const inner = parts.join('');

  // Wrap sole display equations
  // omml from cache is already "<m:oMath ...>...</m:oMath>", so just wrap in oMathPara
  if (isSoleDisplay) {
    const ommlEl = inner.replace(/__DISPLAY_OMML__([\s\S]*?)__\/DISPLAY_OMML__/, '$1');
    const rebuilt = `${openTag}${pPr}<m:oMathPara>${ommlEl}</m:oMathPara></w:p>`;
    return { xml: rebuilt, converted, failed };
  }

  // Inline equations: wrap each <m:oMath>...</m:oMath> inline in paragraph
  // The OMML strings from cache are already full <m:oMath>...</m:oMath> elements
  const rebuilt = `${openTag}${pPr}${inner}</w:p>`;
  return { xml: rebuilt, converted, failed };
}

// ── Document-level replacement ────────────────────────────────────────────────

/** Regex to match a full paragraph (w:p is never nested) */
const PARA_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

/**
 * Replace all LaTeX in document.xml using the pre-built OMML cache.
 *
 * The cache maps "latex content string" → "<m:oMath>...</m:oMath>" string.
 * Note: the cache keys are the LaTeX content WITHOUT delimiters.
 */
export function replaceLatexInXml(
  documentXml: string,
  cache: Map<string, string>,
): { xml: string; stats: ReplaceStats } {
  let totalParagraphs = 0;
  let modifiedParagraphs = 0;
  let converted = 0;
  let failed = 0;

  // Ensure m: namespace is declared
  let xml = ensureMathNamespace(documentXml);

  xml = xml.replace(PARA_RE, (paraXml) => {
    totalParagraphs++;
    const result = processParagraph(paraXml, cache);
    if (result.converted > 0 || result.failed > 0) {
      modifiedParagraphs++;
    }
    converted += result.converted;
    failed += result.failed;
    return result.xml;
  });

  return { xml, stats: { totalParagraphs, modifiedParagraphs, converted, failed } };
}
