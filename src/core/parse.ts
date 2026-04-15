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

/** Extract concatenated text from inside a run */
function extractRunText(runXml: string): string {
  const parts: string[] = [];
  WT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WT_RE.exec(runXml)) !== null) {
    parts.push(m[1]);
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
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Namespace injection ────────────────────────────────────────────────────────

const M_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

/**
 * Ensure the math namespace (m:) is declared on the root <w:document> element.
 * No-op if already present.
 */
export function ensureMathNamespace(xml: string): string {
  if (xml.includes(M_NS)) return xml;
  // Inject into the opening <w:document> tag
  return xml.replace(/(<w:document\b)/, `$1 ${M_NS}`);
}
