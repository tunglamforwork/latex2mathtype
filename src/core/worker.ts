/**
 * worker.ts
 * Worker thread: converts a batch of LaTeX expressions to OMML strings.
 *
 * Called by pipeline.ts via worker_threads.
 * Each worker receives a batch of { latex, displayMode } items and returns
 * { latex, omml, error } results.
 *
 * KaTeX and fast-xml-parser are loaded once per worker (not per equation).
 */

import { workerData, parentPort } from 'worker_threads';
import { fastConvert } from './convert/fastParser';
import { preloadKatex, latexToMathML } from './convert/katexToMathML';
import { mathMLToOmmlInner } from './convert/mathmlToOmml';

export interface WorkerInput {
  batch: Array<{ latex: string; displayMode: boolean }>;
}

export interface WorkerResult {
  latex: string;
  displayMode: boolean;
  omml: string | null;
  error: string | null;
}

// Pre-warm KaTeX once when the worker starts
preloadKatex();

const MATH_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

function convertOne(latex: string, displayMode: boolean): string {
  // Fast path: try simple parser first
  const fast = fastConvert(latex);
  if (fast !== null) {
    return `<m:oMath ${MATH_NS}>${fast}</m:oMath>`;
  }

  // Full path: KaTeX → MathML → OMML
  const mathml = latexToMathML(latex, displayMode);
  const inner = mathMLToOmmlInner(mathml);
  return `<m:oMath ${MATH_NS}>${inner}</m:oMath>`;
}

if (parentPort) {
  const { batch } = workerData as WorkerInput;
  const results: WorkerResult[] = [];

  for (const item of batch) {
    try {
      const omml = convertOne(item.latex, item.displayMode);
      results.push({ latex: item.latex, displayMode: item.displayMode, omml, error: null });
    } catch (e) {
      results.push({
        latex: item.latex,
        displayMode: item.displayMode,
        omml: null,
        error: (e as Error).message,
      });
    }
  }

  parentPort.postMessage(results);
}
