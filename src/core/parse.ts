/**
 * parse.ts
 * XML string utilities for manipulating Word document.xml content.
 *
 * Key operations:
 *  - Merge split <w:r> runs within each paragraph
 *  - Extract text and run-property information
 *  - Ensure the math namespace is declared
 *
 * Approach: regex-based string manipulation (faster than full DOM parsing).
 */

// ── Run extraction ─────────────────────────────────────────────────────────────

export interface RunSegment {
  /** Original run XML (entire <w:r>...</w:r>) */
  runXml: string;
  /** Run properties XML (<w:rPr>...</w:rPr> or empty string) */
  rPr: string;
  /** Decoded text content from all <w:t> elements */
  text: string;
  /** Start index in merged paragraph text */
  start: number;
  /** End index (exclusive) in merged paragraph text */
  end: number;
}

/** Match a <w:t> element and capture its text content */
const WT_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;

/** Decode XML entities back to plain text (reverses xmlEscText) */
function xmlDecText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Extract concatenated text from inside a run (decoded from XML entities) */
function extractRunText(runXml: string): string {
  const parts: string[] = [];
  WT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WT_RE.exec(runXml)) !== null) {
    parts.push(xmlDecText(m[1]));
  }
  return parts.join('');
}

/** Extract <w:rPr>...</w:rPr> from a run (empty string if absent) */
function extractRPr(runXml: string): string {
  const m = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  return m ? m[0] : '';
}

/**
 * Parse all <w:r> elements in a paragraph XML and return
 * run segments with merged-text position tracking.
 *
 * IMPORTANT: does not match runs inside bookmarks/comments/etc.
 * For standard body text this is sufficient.
 */
export function parseParagraphRuns(paraXml: string): RunSegment[] {
  const segments: RunSegment[] = [];
  const runRe = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  let pos = 0;
  let m: RegExpExecArray | null;

  while ((m = runRe.exec(paraXml)) !== null) {
    const runXml = m[0];
    const text = extractRunText(runXml);
    const rPr = extractRPr(runXml);
    segments.push({ runXml, rPr, text, start: pos, end: pos + text.length });
    pos += text.length;
  }

  return segments;
}

/** Merged text for a set of run segments */
export function mergedText(segments: RunSegment[]): string {
  return segments.map(s => s.text).join('');
}

/** Find the rPr of the run that contains character at `pos` in merged text */
export function rPrAtPos(segments: RunSegment[], pos: number): string {
  for (const s of segments) {
    if (pos >= s.start && pos < s.end) return s.rPr;
  }
  return segments.length > 0 ? segments[segments.length - 1].rPr : '';
}

// ── Paragraph extraction ───────────────────────────────────────────────────────

/** Extract paragraph properties (<w:pPr>...</w:pPr>) from paragraph XML */
export function extractPPr(paraXml: string): string {
  const m = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  return m ? m[0] : '';
}

/** Extract paragraph opening tag with all attributes */
export function extractParaOpenTag(paraXml: string): string {
  const m = paraXml.match(/^<w:p(?:\s[^>]*)?>/);
  return m ? m[0] : '<w:p>';
}

// ── XML builders ───────────────────────────────────────────────────────────────

/**
 * Build a <w:r> element with the given run properties and text.
 * Uses xml:space="preserve" when text starts/ends with whitespace.
 */
export function buildRun(rPr: string, text: string): string {
  if (!text) return '';
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  const escaped = xmlEscText(text);
  return `<w:r>${rPr}<w:t${preserve}>${escaped}</w:t></w:r>`;
}

/** XML-escape text content (for use inside <w:t>) */
export function xmlEscText(s: string): string {
  const sanitized = s.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '');
  return sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Namespace injection ────────────────────────────────────────────────────────

const M_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

/**
 * Ensure the math namespace (m:) is declared on the root <w:document> element.
 * No-op if already present on the root element.
 */
export function ensureMathNamespace(xml: string): string {
  // Check specifically if the <w:document> tag has the m: namespace
  const docTagMatch = xml.match(/<w:document\b[^>]*>/);
  if (!docTagMatch) return xml;

  const docTag = docTagMatch[0];
  if (docTag.includes(M_NS)) return xml;

  // Inject into the opening <w:document> tag
  return xml.replace(/(<w:document\b)/, `$1 ${M_NS}`);
}

/** Namespace declarations required for inline image drawings */
const DRAWING_NS = [
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
];

/**
 * Ensure drawing namespaces (wp:, a:, pic:, r:) are declared on the root
 * <w:document> element. Required when inserting <w:drawing> image fallbacks.
 * No-op for each namespace that is already present.
 */
export function ensureDrawingNamespaces(xml: string): string {
  const docTagMatch = xml.match(/<w:document\b[^>]*>/);
  if (!docTagMatch) return xml;

  const docTag = docTagMatch[0];
  const missing = DRAWING_NS.filter(ns => !docTag.includes(ns));
  if (missing.length === 0) return xml;

  const inject = missing.join(' ');
  return xml.replace(/(<w:document\b)/, `$1 ${inject}`);
}

// ── Math-region stripping ──────────────────────────────────────────────────────

/**
 * Strip already-converted <m:oMath> regions from paragraph XML before run
 * detection. Prevents false-positive LaTeX matches inside existing OMML equations
 * (e.g., if an OMML element string incidentally contains a $ character).
 */
export function stripMathRegions(paraXml: string): string {
  return paraXml.replace(/<m:oMath[\s\S]*?<\/m:oMath>/g, '');
}
