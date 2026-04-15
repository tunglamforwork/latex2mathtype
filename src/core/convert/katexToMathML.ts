/**
 * katexToMathML.ts
 * Converts a LaTeX string to a MathML string using KaTeX.
 * Extracts just the <math>...</math> element from KaTeX's output.
 */

import katex from 'katex';

let katexLoaded = false;

/** Pre-warm KaTeX by doing a dummy render (loads its internal tables once) */
export function preloadKatex(): void {
  if (katexLoaded) return;
  try {
    katex.renderToString('x', { output: 'mathml', throwOnError: false });
    katexLoaded = true;
  } catch {
    // Ignore
  }
}

/**
 * Convert a LaTeX expression to a MathML string.
 * Returns the <math>...</math> element (without surrounding HTML).
 * Throws if KaTeX cannot parse the expression.
 */
export function latexToMathML(latex: string, displayMode: boolean): string {
  const html = katex.renderToString(latex, {
    output: 'mathml',
    displayMode,
    throwOnError: true,
    strict: false,
    trust: false,
  });

  // KaTeX wraps the <math> in <span class="katex">...</span>
  // Extract the <math>...</math> element
  const mathStart = html.indexOf('<math');
  const mathEnd = html.lastIndexOf('</math>');

  if (mathStart === -1 || mathEnd === -1) {
    throw new Error('KaTeX did not produce valid MathML output');
  }

  return html.slice(mathStart, mathEnd + 7); // 7 = '</math>'.length
}
