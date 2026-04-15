/**
 * fastParser.ts
 * Fast-path LaTeX → OMML converter for simple expressions.
 * Handles fractions, sub/superscripts, Greek letters, and basic text
 * without invoking KaTeX. Returns null for complex expressions that
 * should fall through to the KaTeX pipeline.
 */

// Map of LaTeX commands to Unicode characters
const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ',
  sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  // Uppercase
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε',
  Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ',
  Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ', Pi: 'Π',
  Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ',
  Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
};

const OPS: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓',
  leq: '≤', geq: '≥', neq: '≠', approx: '≈', equiv: '≡',
  in: '∈', notin: '∉', subset: '⊂', supset: '⊃',
  cup: '∪', cap: '∩', infty: '∞', partial: '∂',
  nabla: '∇', forall: '∀', exists: '∃',
  rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⟺',
  to: '→', gets: '←', implies: '⟹',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  sqrt: '√', sum: '∑', prod: '∏', int: '∫',
};

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Wrap text in an OMML run. style: 'i' italic, 'p' plain, 'n' normal (number) */
function run(text: string, style?: 'i' | 'p' | 'n'): string {
  const rPr = style && style !== 'n'
    ? `<m:rPr><m:sty m:val="${style}"/></m:rPr>`
    : '';
  return `<m:r>${rPr}<m:t>${xmlEsc(text)}</m:t></m:r>`;
}

/** Parse a LaTeX group: {...} or a single char/command */
function parseGroup(src: string, pos: number): { content: string; end: number } | null {
  if (pos >= src.length) return null;

  if (src[pos] === '{') {
    let depth = 1;
    let i = pos + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) return null;
    return { content: src.slice(pos + 1, i - 1), end: i };
  }

  if (src[pos] === '\\') {
    // Command
    let i = pos + 1;
    while (i < src.length && /[a-zA-Z]/.test(src[i])) i++;
    if (i === pos + 1 && i < src.length) i++; // single non-alpha char like \\, \{
    return { content: src.slice(pos, i), end: i };
  }

  // Single character
  return { content: src[pos], end: pos + 1 };
}

/** Convert a simple LaTeX token to OMML */
function tokenToOmml(token: string): string {
  token = token.trim();
  if (!token) return '';

  // Backslash command
  if (token.startsWith('\\')) {
    const cmd = token.slice(1);
    if (GREEK[cmd]) return run(GREEK[cmd], 'i');
    if (OPS[cmd]) return run(OPS[cmd], 'p');
    if (cmd === 'infty') return run('∞', 'p');
    if (cmd === ' ' || cmd === ',') return `<m:r><m:t xml:space="preserve"> </m:t></m:r>`;
    // Unknown command — pass through as text
    return run(token, 'p');
  }

  // Number
  if (/^[0-9]+(\.[0-9]+)?$/.test(token)) {
    return run(token, 'n');
  }

  // Single letter → italic identifier
  if (/^[a-zA-Z]$/.test(token)) {
    return run(token, 'i');
  }

  // Operator/symbol
  return run(token, 'p');
}

/** Recursively convert a LaTeX group content to OMML */
function groupToOmml(content: string): string {
  return fastConvert(content) ?? tokenToOmml(content);
}

/**
 * Attempt fast conversion of a LaTeX expression to OMML inner XML.
 * Returns null if the expression is too complex for the fast path.
 */
export function fastConvert(latex: string): string | null {
  latex = latex.trim();
  if (!latex) return '';

  // --- Single token (no spaces, no special structure) ---
  if (/^[a-zA-Z0-9]$/.test(latex)) {
    return tokenToOmml(latex);
  }

  if (/^\\[a-zA-Z]+$/.test(latex)) {
    return tokenToOmml(latex);
  }

  // --- \frac{num}{den} ---
  if (latex.startsWith('\\frac')) {
    let pos = 5; // after '\frac'
    while (pos < latex.length && latex[pos] === ' ') pos++;
    const num = parseGroup(latex, pos);
    if (!num) return null;
    pos = num.end;
    while (pos < latex.length && latex[pos] === ' ') pos++;
    const den = parseGroup(latex, pos);
    if (!den) return null;

    const rest = latex.slice(den.end).trim();
    const numOmml = groupToOmml(num.content);
    const denOmml = groupToOmml(den.content);
    const frac = `<m:f><m:num>${numOmml}</m:num><m:den>${denOmml}</m:den></m:f>`;

    if (rest) {
      const restOmml = fastConvert(rest);
      if (!restOmml) return null;
      return frac + restOmml;
    }
    return frac;
  }

  // --- \sqrt{content} ---
  if (latex.startsWith('\\sqrt')) {
    let pos = 5;
    while (pos < latex.length && latex[pos] === ' ') pos++;
    const inner = parseGroup(latex, pos);
    if (!inner) return null;
    const innerOmml = groupToOmml(inner.content);
    const rest = latex.slice(inner.end).trim();
    const sqrt = `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${innerOmml}</m:e></m:rad>`;
    if (rest) {
      const restOmml = fastConvert(rest);
      if (!restOmml) return null;
      return sqrt + restOmml;
    }
    return sqrt;
  }

  // --- Sub/superscripts: need to parse token ^ { } and _ { } ---
  // We handle: base^{sup}, base_{sub}, base^{sup}_{sub}, base_{sub}^{sup}
  // base can be: single char, \cmd, or {group}
  {
    const result = parseSubSup(latex);
    if (result !== null) return result;
  }

  // --- Simple sequence of tokens without grouping ---
  // If no braces and only simple tokens, convert token by token
  if (!/[{}]/.test(latex)) {
    return convertTokenSequence(latex);
  }

  return null; // complex — fall through to KaTeX
}

/** LaTeX commands that are n-ary operators — must go through KaTeX for proper <m:nary> output */
const NARY_COMMANDS = new Set([
  'int', 'iint', 'iiint', 'iiiint', 'oint', 'oiint',
  'sum', 'prod', 'coprod',
  'bigcup', 'bigcap', 'bigsqcup', 'biguplus',
  'bigvee', 'bigwedge', 'bigodot', 'bigoplus', 'bigotimes',
]);

function parseSubSup(src: string): string | null {
  let pos = 0;

  // Parse base
  const base = parseGroup(src, pos);
  if (!base) return null;
  pos = base.end;

  // If base is a nary operator, fall through to KaTeX for proper <m:nary> output
  if (base.content.startsWith('\\') && NARY_COMMANDS.has(base.content.slice(1))) {
    return null;
  }

  while (pos < src.length && src[pos] === ' ') pos++;
  if (pos >= src.length) return null; // no sub/sup

  // Must be ^ or _
  let subContent: string | null = null;
  let supContent: string | null = null;

  // Allow ^{ }^{ } combinations
  let passes = 0;
  while (pos < src.length && (src[pos] === '^' || src[pos] === '_') && passes < 4) {
    const op = src[pos];
    pos++;
    while (pos < src.length && src[pos] === ' ') pos++;
    const g = parseGroup(src, pos);
    if (!g) return null;
    if (op === '^') supContent = g.content;
    else subContent = g.content;
    pos = g.end;
    while (pos < src.length && src[pos] === ' ') pos++;
    passes++;
  }

  if (subContent === null && supContent === null) return null;

  const baseOmml = groupToOmml(base.content);
  const rest = src.slice(pos).trim();
  let result: string;

  if (subContent !== null && supContent !== null) {
    result = `<m:sSubSup><m:e>${baseOmml}</m:e><m:sub>${groupToOmml(subContent)}</m:sub><m:sup>${groupToOmml(supContent)}</m:sup></m:sSubSup>`;
  } else if (supContent !== null) {
    result = `<m:sSup><m:e>${baseOmml}</m:e><m:sup>${groupToOmml(supContent)}</m:sup></m:sSup>`;
  } else {
    result = `<m:sSub><m:e>${baseOmml}</m:e><m:sub>${groupToOmml(subContent!)}</m:sub></m:sSub>`;
  }

  if (rest) {
    const restOmml = fastConvert(rest);
    if (!restOmml) return null;
    return result + restOmml;
  }
  return result;
}

function convertTokenSequence(src: string): string | null {
  // Simple tokenizer for strings without braces
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '\\') {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      if (j === i + 1 && j < src.length) j++; // single special char
      tokens.push(src.slice(i, j));
      i = j;
    } else if (src[i] === ' ' || src[i] === '\t') {
      tokens.push(' ');
      i++;
    } else {
      tokens.push(src[i]);
      i++;
    }
  }

  // Process tokens, handling ^ and _ as script operators
  const result: string[] = [];
  let ti = 0;
  while (ti < tokens.length) {
    const tok = tokens[ti];

    if (tok === '^' || tok === '_') {
      const base = result.pop() ?? '';
      const argTok = tokens[ti + 1];
      if (!argTok || argTok === '^' || argTok === '_' || argTok === ' ') {
        if (base) result.push(base);
        result.push(tokenToOmml(tok));
        ti++;
        continue;
      }
      const arg = tokenToOmml(argTok);
      ti += 2;

      // Detect combined sub+sup: x_i^2 or x^2_i
      const nextOp = tokens[ti];
      if ((tok === '^' && nextOp === '_') || (tok === '_' && nextOp === '^')) {
        const arg2Tok = tokens[ti + 1];
        if (arg2Tok && arg2Tok !== '^' && arg2Tok !== '_' && arg2Tok !== ' ') {
          const arg2 = tokenToOmml(arg2Tok);
          ti += 2;
          const [sub, sup] = tok === '_' ? [arg, arg2] : [arg2, arg];
          result.push(
            `<m:sSubSup><m:e>${base}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`,
          );
          continue;
        }
      }

      if (tok === '^') {
        result.push(`<m:sSup><m:e>${base}</m:e><m:sup>${arg}</m:sup></m:sSup>`);
      } else {
        result.push(`<m:sSub><m:e>${base}</m:e><m:sub>${arg}</m:sub></m:sSub>`);
      }
    } else if (tok === ' ') {
      result.push(`<m:r><m:t xml:space="preserve"> </m:t></m:r>`);
      ti++;
    } else {
      result.push(tokenToOmml(tok));
      ti++;
    }
  }

  return result.join('');
}
