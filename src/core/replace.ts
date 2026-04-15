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
import { XMLValidator } from 'fast-xml-parser';
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

const PARA_VALIDATE_ROOT_SUFFIX = '</root>';

function collectXmlPrefixes(xml: string): string[] {
  const prefixes = new Set<string>();
  const re = /([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const p = m[1];
    if (p === 'xml' || p === 'xmlns') continue;
    prefixes.add(p);
  }
  return [...prefixes];
}

function isValidParagraphXml(paraXml: string): boolean {
  const prefixes = collectXmlPrefixes(paraXml);
  const nsDecls = prefixes
    .map((p) =>
      p === 'w'
        ? 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
        : p === 'm'
          ? 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
          : `xmlns:${p}="urn:auto:${p}"`,
    )
    .join(' ');
  const wrapped = `<root ${nsDecls}>${paraXml}${PARA_VALIDATE_ROOT_SUFFIX}`;
  return XMLValidator.validate(wrapped) === true;
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

  // Check if entire paragraph is a single display equation
  const isSoleDisplay =
    matches.length === 1 &&
    matches[0].displayMode &&
    text.slice(0, matches[0].start).trim() === '' &&
    text.slice(matches[0].end).trim() === '';

  if (isSoleDisplay) {
    const omml = cache.get(matches[0].latex);
    if (omml) {
      // Discard surrounding whitespace <w:r> runs to prevent invalid XML inside <m:oMathPara>
      const rebuilt = `${openTag}${pPr}<m:oMathPara>${omml}</m:oMathPara></w:p>`;
      if (!isValidParagraphXml(rebuilt)) {
        return { xml: paraXml, converted: 0, failed: 1 };
      }
      return { xml: rebuilt, converted: 1, failed: 0 };
    }
  }

  const parts: string[] = [];
  let cursor = 0;

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
      parts.push(omml);
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

  // Inline equations: wrap each <m:oMath>...</m:oMath> inline in paragraph
  const rebuilt = `${openTag}${pPr}${inner}</w:p>`;
  if (!isValidParagraphXml(rebuilt)) {
    return { xml: paraXml, converted: 0, failed: matches.length };
  }
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
