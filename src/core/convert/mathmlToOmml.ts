/**
 * mathmlToOmml.ts
 * Converts a MathML string to an OMML (Office Math Markup Language) string.
 * Compatible with Microsoft Word / MathType.
 *
 * Uses fast-xml-parser with preserveOrder:true so element order is maintained.
 */

import { XMLParser } from 'fast-xml-parser';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A node as emitted by fast-xml-parser in preserveOrder mode */
type FxpNode = Record<string, unknown>;

const MATH_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

// ── Parser (singleton) ────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
});

// ── Nary operator characters ──────────────────────────────────────────────────

const NARY_OPS = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋁', '⋀', '⋃', '⋂']);

function isNaryOp(text: string): boolean {
  return NARY_OPS.has(text.trim());
}

// ── Accent characters (for mover) ─────────────────────────────────────────────

const ACCENT_MAP: Record<string, string> = {
  '^': '^', 'ˆ': '^', '~': '~', '˜': '~', '‾': '‾',
  '→': '→', '⃗': '→', '·': '·', '¨': '¨', '˙': '·',
  '̄': '‾', '¯': '‾', '̂': '^', '̃': '~',
};

function getAccentChar(text: string): string | null {
  return ACCENT_MAP[text.trim()] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function xmlEsc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Get the tag name of an fxp node (the key that is not ':@' or '#text') */
function getTag(node: FxpNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text') return key;
  }
  return '#text';
}

/** Get children array of a node */
function getChildren(node: FxpNode): FxpNode[] {
  const tag = getTag(node);
  if (tag === '#text') return [];
  const v = node[tag];
  return Array.isArray(v) ? (v as FxpNode[]) : [];
}

/** Get attribute value */
function getAttr(node: FxpNode, attrName: string): string {
  const attrs = node[':@'] as Record<string, string> | undefined;
  return attrs?.[`@_${attrName}`] ?? '';
}

/** Get text content of a node's children */
function getTextContent(children: FxpNode[]): string {
  return children
    .filter(c => getTag(c) === '#text')
    .map(c => String(c['#text']))
    .join('');
}

// ── OMML Builders ─────────────────────────────────────────────────────────────

function ommlRun(text: string, style?: 'i' | 'p' | 'bi' | 'b'): string {
  const rPr = style ? `<m:rPr><m:sty m:val="${style}"/></m:rPr>` : '';
  return `<m:r>${rPr}<m:t>${xmlEsc(text)}</m:t></m:r>`;
}

function ommlFrac(num: string, den: string): string {
  return `<m:f><m:num>${num}</m:num><m:den>${den}</m:den></m:f>`;
}

function ommlSup(base: string, sup: string): string {
  return `<m:sSup><m:e>${base}</m:e><m:sup>${sup}</m:sup></m:sSup>`;
}

function ommlSub(base: string, sub: string): string {
  return `<m:sSub><m:e>${base}</m:e><m:sub>${sub}</m:sub></m:sSub>`;
}

function ommlSubSup(base: string, sub: string, sup: string): string {
  return `<m:sSubSup><m:e>${base}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
}

function ommlSqrt(inner: string): string {
  return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${inner}</m:e></m:rad>`;
}

function ommlRoot(deg: string, inner: string): string {
  return `<m:rad><m:radPr/><m:deg>${deg}</m:deg><m:e>${inner}</m:e></m:rad>`;
}

function ommlLimLow(base: string, lim: string): string {
  return `<m:limLow><m:e>${base}</m:e><m:lim>${lim}</m:lim></m:limLow>`;
}

function ommlLimUpp(base: string, lim: string): string {
  return `<m:limUpp><m:e>${base}</m:e><m:lim>${lim}</m:lim></m:limUpp>`;
}

function ommlNary(chr: string, sub: string, sup: string, body: string, limLoc: string): string {
  const subHide = sub ? '0' : '1';
  const supHide = sup ? '0' : '1';
  return (
    `<m:nary>` +
    `<m:naryPr>` +
    `<m:chr m:val="${xmlEsc(chr)}"/>` +
    `<m:limLoc m:val="${limLoc}"/>` +
    `<m:subHide m:val="${subHide}"/>` +
    `<m:supHide m:val="${supHide}"/>` +
    `</m:naryPr>` +
    `<m:sub>${sub}</m:sub>` +
    `<m:sup>${sup}</m:sup>` +
    `<m:e>${body}</m:e>` +
    `</m:nary>`
  );
}

function ommlAcc(chr: string, base: string): string {
  return (
    `<m:acc>` +
    `<m:accPr><m:chr m:val="${xmlEsc(chr)}"/></m:accPr>` +
    `<m:e>${base}</m:e>` +
    `</m:acc>`
  );
}

function ommlBar(base: string, pos: 'top' | 'bot'): string {
  return (
    `<m:bar>` +
    `<m:barPr><m:pos m:val="${pos}"/></m:barPr>` +
    `<m:e>${base}</m:e>` +
    `</m:bar>`
  );
}

function ommlDelim(beg: string, end: string, sep: string, inner: string): string {
  const begEl = beg !== '(' ? `<m:begChr m:val="${xmlEsc(beg)}"/>` : '';
  const endEl = end !== ')' ? `<m:endChr m:val="${xmlEsc(end)}"/>` : '';
  const sepEl = sep ? `<m:sepChr m:val="${xmlEsc(sep)}"/>` : '';
  return (
    `<m:d>` +
    `<m:dPr>${begEl}${endEl}${sepEl}</m:dPr>` +
    `<m:e>${inner}</m:e>` +
    `</m:d>`
  );
}

// ── Node Converter ────────────────────────────────────────────────────────────

/** Convert children, optionally skipping certain tags */
function convertChildren(children: FxpNode[], skip?: Set<string>): string {
  return children
    .filter(c => !skip || !skip.has(getTag(c)))
    .map(c => convertNode(c))
    .join('');
}

/**
 * Convert children of an mrow, with special handling for n-ary operators
 * that need to consume remaining siblings as their body.
 *
 * Handles:
 *  - munderover / munder / mover  (display mode: limits above/below)
 *  - msubsup / msub / msup        (inline mode: limits as scripts)
 * In both cases, all following siblings become the nary body.
 */
function convertMrowChildren(children: FxpNode[]): string {
  const parts: string[] = [];
  let i = 0;

  while (i < children.length) {
    const node = children[i];
    const tag = getTag(node);

    // Detect nary: munderover/munder/mover or msubsup/msub/msup whose base is a nary op
    if (
      tag === 'munderover' || tag === 'munder' || tag === 'mover' ||
      tag === 'msubsup' || tag === 'msub' || tag === 'msup'
    ) {
      const ch = getChildren(node);
      const base = ch[0];
      if (base && getTag(base) === 'mo') {
        const opText = getTextContent(getChildren(base)).trim();
        if (isNaryOp(opText)) {
          let sub = '';
          let sup = '';
          let limLoc = 'subSup';

          if (tag === 'munderover') {
            sub = ch[1] ? convertNode(ch[1]) : '';
            sup = ch[2] ? convertNode(ch[2]) : '';
            limLoc = 'undOvr';
          } else if (tag === 'munder') {
            sub = ch[1] ? convertNode(ch[1]) : '';
            limLoc = 'undOvr';
          } else if (tag === 'mover') {
            sup = ch[1] ? convertNode(ch[1]) : '';
            limLoc = 'undOvr';
          } else if (tag === 'msubsup') {
            sub = ch[1] ? convertNode(ch[1]) : '';
            sup = ch[2] ? convertNode(ch[2]) : '';
            limLoc = 'subSup';
          } else if (tag === 'msub') {
            sub = ch[1] ? convertNode(ch[1]) : '';
            limLoc = 'subSup';
          } else if (tag === 'msup') {
            sup = ch[1] ? convertNode(ch[1]) : '';
            limLoc = 'subSup';
          }

          // Consume ALL remaining siblings as the body (they form the integrand/summand)
          i++;
          const bodyParts: string[] = [];
          while (i < children.length) {
            bodyParts.push(convertNode(children[i]));
            i++;
          }
          const body = bodyParts.join('');

          parts.push(ommlNary(opText, sub, sup, body, limLoc));
          continue;
        }
      }
    }

    parts.push(convertNode(node));
    i++;
  }

  return parts.join('');
}

function convertNode(node: FxpNode): string {
  if (!node) return '';

  const tag = getTag(node);

  // Text node
  if (tag === '#text') {
    return ''; // standalone text nodes in MathML are handled by parent
  }

  const children = getChildren(node);

  switch (tag) {
    // ── Transparent / structural ─────────────────────────────────────────────
    case 'math':
      return convertChildren(children);

    case 'semantics': {
      // Skip <annotation> children
      const skip = new Set(['annotation', 'annotation-xml']);
      return convertChildren(children, skip);
    }

    case 'mrow':
      return convertMrowChildren(children);

    case 'mpadded':
    case 'mstyle':
    case 'merror':
    case 'maction':
      return convertChildren(children);

    case 'mphantom':
    case 'annotation':
    case 'annotation-xml':
      return '';

    // ── Leaf tokens ──────────────────────────────────────────────────────────
    case 'mi': {
      const text = getTextContent(children);
      // Single latin letter → italic; math-variant="normal" or multi-char → plain
      const variant = getAttr(node, 'mathvariant');
      const style = (variant === 'normal' || text.length > 1) ? 'p' : 'i';
      return ommlRun(text, style);
    }

    case 'mn': {
      const text = getTextContent(children);
      return ommlRun(text);
    }

    case 'mo': {
      const text = getTextContent(children);
      return ommlRun(text, 'p');
    }

    case 'mtext': {
      const text = getTextContent(children);
      return ommlRun(text, 'p');
    }

    case 'ms': {
      const text = getTextContent(children);
      return ommlRun(`"${text}"`, 'p');
    }

    case 'mspace':
      return `<m:r><m:t xml:space="preserve"> </m:t></m:r>`;

    // ── Fractions ────────────────────────────────────────────────────────────
    case 'mfrac': {
      if (children.length < 2) return convertChildren(children);
      const [c0, c1] = children;
      // Check linethickness=0 → binomial (for now just render as fraction)
      return ommlFrac(convertNode(c0), convertNode(c1));
    }

    // ── Scripts ──────────────────────────────────────────────────────────────
    case 'msup': {
      if (children.length < 2) return convertChildren(children);
      // Check if base is a nary operator (no body available outside mrow context)
      if (getTag(children[0]) === 'mo' && isNaryOp(getTextContent(getChildren(children[0])).trim())) {
        const opText = getTextContent(getChildren(children[0])).trim();
        return ommlNary(opText, '', convertNode(children[1]), '', 'subSup');
      }
      return ommlSup(convertNode(children[0]), convertNode(children[1]));
    }

    case 'msub': {
      if (children.length < 2) return convertChildren(children);
      // Check if base is a nary operator
      if (getTag(children[0]) === 'mo' && isNaryOp(getTextContent(getChildren(children[0])).trim())) {
        const opText = getTextContent(getChildren(children[0])).trim();
        return ommlNary(opText, convertNode(children[1]), '', '', 'subSup');
      }
      return ommlSub(convertNode(children[0]), convertNode(children[1]));
    }

    case 'msubsup': {
      if (children.length < 3) return convertChildren(children);
      // Check if base is a nary operator
      if (getTag(children[0]) === 'mo' && isNaryOp(getTextContent(getChildren(children[0])).trim())) {
        const opText = getTextContent(getChildren(children[0])).trim();
        return ommlNary(opText, convertNode(children[1]), convertNode(children[2]), '', 'subSup');
      }
      return ommlSubSup(
        convertNode(children[0]),
        convertNode(children[1]),
        convertNode(children[2]),
      );
    }

    case 'mmultiscripts': {
      // Simplified: just render base and first post-script
      if (children.length < 3) return convertChildren(children);
      return ommlSubSup(
        convertNode(children[0]),
        convertNode(children[1]),
        convertNode(children[2]),
      );
    }

    // ── Radicals ─────────────────────────────────────────────────────────────
    case 'msqrt': {
      return ommlSqrt(convertChildren(children));
    }

    case 'mroot': {
      if (children.length < 2) return ommlSqrt(convertChildren(children));
      return ommlRoot(convertNode(children[1]), convertNode(children[0]));
    }

    // ── Limits / accents ─────────────────────────────────────────────────────
    case 'munder': {
      if (children.length < 2) return convertChildren(children);
      const [base, under] = children;
      const underText = getTextContent(getChildren(under)).trim();
      // _̲ or ‾ as underbar
      if (underText === '_' || underText === '‾' || underText === '¯') {
        return ommlBar(convertNode(base), 'bot');
      }
      // nary check already done in convertMrowChildren
      return ommlLimLow(convertNode(base), convertNode(under));
    }

    case 'mover': {
      if (children.length < 2) return convertChildren(children);
      const [base, over] = children;
      const overChildren = getChildren(over);
      const overText = getTextContent(overChildren).trim();
      const accentChr = getAccentChar(overText);

      if (accentChr !== null) {
        if (accentChr === '‾' || accentChr === '¯') {
          return ommlBar(convertNode(base), 'top');
        }
        return ommlAcc(accentChr, convertNode(base));
      }
      return ommlLimUpp(convertNode(base), over ? convertNode(over) : '');
    }

    case 'munderover': {
      if (children.length < 3) return convertChildren(children);
      const [base, under, over] = children;
      const baseText = getTextContent(getChildren(base)).trim();

      if (isNaryOp(baseText)) {
        return ommlNary(
          baseText,
          convertNode(under),
          convertNode(over),
          '', // body empty — filled by parent mrow context
          'undOvr',
        );
      }

      // Stacked limits: base with both under and over
      const inner = ommlLimLow(convertNode(base), convertNode(under));
      return ommlLimUpp(inner, convertNode(over));
    }

    // ── Delimiters ───────────────────────────────────────────────────────────
    case 'mfenced': {
      const open = getAttr(node, 'open') || '(';
      const close = getAttr(node, 'close') || ')';
      const sep = getAttr(node, 'separators') || ',';

      if (children.length === 0) return ommlDelim(open, close, '', '');
      if (children.length === 1) {
        return ommlDelim(open, close, '', convertNode(children[0]));
      }
      // Multiple children separated by sep
      const inner = children.map(c => `<m:e>${convertNode(c)}</m:e>`).join('');
      const begEl = open !== '(' ? `<m:begChr m:val="${xmlEsc(open)}"/>` : '';
      const endEl = close !== ')' ? `<m:endChr m:val="${xmlEsc(close)}"/>` : '';
      const sepEl = sep ? `<m:sepChr m:val="${xmlEsc(sep[0] ?? ',')}"/>` : '';
      return `<m:d><m:dPr>${begEl}${endEl}${sepEl}</m:dPr>${inner}</m:d>`;
    }

    // ── Tables / matrices ────────────────────────────────────────────────────
    case 'mtable': {
      const rows = children
        .filter(c => getTag(c) === 'mtr')
        .map(r => {
          const cells = getChildren(r)
            .filter(c => getTag(c) === 'mtd')
            .map(cell => `<m:e>${convertChildren(getChildren(cell))}</m:e>`)
            .join('');
          return `<m:mr>${cells}</m:mr>`;
        })
        .join('');
      return `<m:m><m:mPr><m:baseJc m:val="center"/></m:mPr>${rows}</m:m>`;
    }

    case 'mtr': {
      const cells = children
        .filter(c => getTag(c) === 'mtd')
        .map(cell => `<m:e>${convertChildren(getChildren(cell))}</m:e>`)
        .join('');
      return `<m:mr>${cells}</m:mr>`;
    }

    case 'mtd':
      return `<m:e>${convertChildren(children)}</m:e>`;

    // ── Fallback ─────────────────────────────────────────────────────────────
    default:
      return convertChildren(children);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a MathML string to OMML inner XML (the content inside <m:oMath>).
 * The returned string does NOT include the <m:oMath> wrapper.
 */
export function mathMLToOmmlInner(mathml: string): string {
  // Normalize namespace prefixes that KaTeX might emit
  const cleaned = mathml.replace(/ xmlns(?::\w+)?="[^"]*"/g, '');

  let parsed: FxpNode[];
  try {
    parsed = parser.parse(`<root>${cleaned}</root>`) as FxpNode[];
  } catch (e) {
    throw new Error(`MathML parse error: ${(e as Error).message}`);
  }

  // Drill down: root → root's children
  const root = parsed[0];
  if (!root) return '';
  const rootChildren = getChildren(root) as FxpNode[];

  return rootChildren.map(child => convertNode(child)).join('');
}

/**
 * Convert a MathML string to a full <m:oMath> element string.
 */
export function mathMLToOmml(mathml: string): string {
  const inner = mathMLToOmmlInner(mathml);
  return `<m:oMath ${MATH_NS}>${inner}</m:oMath>`;
}
