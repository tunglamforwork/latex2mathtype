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
  ensureDrawingNamespaces,
  stripMathRegions,
} from './parse';

export interface ReplaceStats {
  totalParagraphs: number;
  modifiedParagraphs: number;
  converted: number;
  failed: number;
}

/** Metadata for a LaTeX expression rendered as a PNG image fallback */
export interface ImageCacheEntry {
  /** Relationship ID referencing the image file in word/_rels/document.xml.rels */
  rId: string;
  /** Image width in EMU (English Metric Units) */
  widthEmu: number;
  /** Image height in EMU */
  heightEmu: number;
  /** Unique integer ID for the <wp:docPr> element (must be unique across document) */
  docPrId: number;
}

export type ImageCache = Map<string, ImageCacheEntry>;

// ── Image drawing builder ──────────────────────────────────────────────────────

/**
 * Build a <w:r><w:drawing> XML fragment for an inline image.
 * Namespace prefixes (wp:, a:, pic:, r:) must be declared on <w:document>.
 */
function buildImageDrawing(entry: ImageCacheEntry): string {
  const { rId, widthEmu, heightEmu, docPrId } = entry;
  const name = `Equation${docPrId}`;
  return (
    `<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="114300" distR="114300">` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic>` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic>` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="${docPrId}" name="${name}"/>` +
    `<pic:cNvPicPr/>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${rId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing></w:r>`
  );
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
 *
 * Run-aware detection: all <w:r> runs are merged into a single string before
 * LaTeX detection, so equations split across multiple runs are found correctly.
 * Pre-existing <m:oMath> regions are stripped before detection to avoid
 * false matches inside already-converted equations.
 */
function processParagraph(
  paraXml: string,
  cache: Map<string, string>,
  imageCache: ImageCache,
  docPrIdRef: { next: number },
): { xml: string; converted: number; failed: number } {
  // Strip existing OMML regions before run extraction to avoid false detections
  const paraXmlForDetection = stripMathRegions(paraXml);
  const segments = parseParagraphRuns(paraXmlForDetection);
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
    // Image fallback for sole display equation: insert as inline run (no oMathPara)
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

    // 1. Try OMML from worker conversion
    const omml = cache.get(match.latex);
    if (omml) {
      parts.push(omml);
      converted++;
    } else {
      // 2. Try image fallback
      const imgEntry = imageCache.get(match.latex);
      if (imgEntry) {
        parts.push(buildImageDrawing(imgEntry));
        converted++;
        docPrIdRef.next++;
      } else {
        // 3. Conversion failed entirely — keep original raw LaTeX as text
        const rPr = rPrAtPos(segments, match.start);
        parts.push(buildRun(rPr, match.raw));
        failed++;
      }
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
 * Replace all LaTeX in document.xml using the pre-built OMML and image caches.
 *
 * ommlCache maps latex content string → "<m:oMath>...</m:oMath>" string.
 * imageCache maps latex content string → image metadata for <w:drawing> insertion.
 * Keys are the LaTeX content WITHOUT delimiters (trimmed).
 *
 * Detection is run-aware: runs within each <w:p> are merged before regex matching,
 * so equations split across multiple <w:r> nodes are correctly detected.
 */
export function replaceLatexInXml(
  documentXml: string,
  ommlCache: Map<string, string>,
  imageCache: ImageCache = new Map(),
): { xml: string; stats: ReplaceStats } {
  let totalParagraphs = 0;
  let modifiedParagraphs = 0;
  let converted = 0;
  let failed = 0;

  // Ensure required namespaces are declared on the root element
  let xml = ensureMathNamespace(documentXml);
  if (imageCache.size > 0) {
    xml = ensureDrawingNamespaces(xml);
  }

  // Shared counter for unique <wp:docPr id="..."> values across all paragraphs
  const docPrIdRef = { next: 10000 };

  xml = xml.replace(PARA_RE, (paraXml) => {
    totalParagraphs++;
    const result = processParagraph(paraXml, ommlCache, imageCache, docPrIdRef);
    if (result.converted > 0 || result.failed > 0) {
      modifiedParagraphs++;
    }
    converted += result.converted;
    failed += result.failed;
    return result.xml;
  });

  return { xml, stats: { totalParagraphs, modifiedParagraphs, converted, failed } };
}
