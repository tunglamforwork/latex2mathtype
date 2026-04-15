/**
 * pipeline.ts
 * Main conversion pipeline: .docx → OMML .docx
 *
 * Steps:
 *  1. Unzip .docx
 *  2. Parse document.xml to collect all LaTeX
 *  3. Deduplicate
 *  4. Convert in parallel worker threads
 *  5. Replace LaTeX with OMML in XML
 *  6. Rezip as new .docx
 */

import * as path from 'path';
import * as os from 'os';
import { Worker } from 'worker_threads';
import { unzipDocx } from './unzip';
import { zipDocx } from './zip';
import { detectLatexInText, LatexMatch } from './detectLatex';
import { deduplicateLatex, splitIntoBatches, UniqueLatex } from './dedupe';
import { replaceLatexInXml, ReplaceStats } from './replace';
import { WorkerResult } from './worker';

export interface ProgressInfo {
  status: 'scanning' | 'converting' | 'replacing' | 'zipping' | 'done' | 'error';
  total: number;
  converted: number;
  failed: number;
  message?: string;
}

export type ProgressCallback = (info: ProgressInfo) => void;

export interface PipelineResult {
  success: boolean;
  stats: {
    total: number;
    converted: number;
    failed: number;
    durationMs: number;
  };
  error?: string;
}

// ── Worker path resolution ─────────────────────────────────────────────────────

/** Resolve path to the bundled worker script */
function getWorkerPath(): string {
  // pipeline.ts is bundled into dist/main.js or dist/cli.js → __dirname = dist/
  // worker.ts is bundled into dist/core/worker.js
  return path.join(__dirname, 'core', 'worker.js');
}

// ── Parallel conversion ────────────────────────────────────────────────────────

function runWorker(
  workerPath: string,
  batch: Array<{ latex: string; displayMode: boolean }>,
): Promise<WorkerResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { batch } });
    worker.on('message', (results: WorkerResult[]) => resolve(results));
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

async function convertBatch(
  unique: UniqueLatex[],
  onProgress: ProgressCallback,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  if (unique.length === 0) return cache;

  const numWorkers = Math.min(os.cpus().length, unique.length, 8);
  const workerPath = getWorkerPath();

  const items = unique.map(u => ({ latex: u.latex, displayMode: u.displayMode }));
  const batches = splitIntoBatches(items, numWorkers);

  let converted = 0;
  let failed = 0;

  // Launch all workers in parallel
  const workerPromises = batches.map(batch => runWorker(workerPath, batch));

  // Process results as they arrive
  const allResults = await Promise.all(workerPromises);

  for (const results of allResults) {
    for (const r of results) {
      if (r.omml) {
        cache.set(r.latex, r.omml);
        converted++;
      } else {
        failed++;
      }
      onProgress({
        status: 'converting',
        total: unique.length,
        converted,
        failed,
      });
    }
  }

  return cache;
}

// ── All-text LaTeX scan ────────────────────────────────────────────────────────

/**
 * Scan document.xml for LaTeX by merging runs within each paragraph.
 * This correctly handles cases where Word splits a LaTeX expression
 * across multiple <w:r> runs (e.g. "$x", "^", "2$").
 */
const PARA_SCAN_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const WT_SCAN_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;

function collectAllLatex(documentXml: string): LatexMatch[] {
  const all: LatexMatch[] = [];
  PARA_SCAN_RE.lastIndex = 0;
  let para: RegExpExecArray | null;

  while ((para = PARA_SCAN_RE.exec(documentXml)) !== null) {
    const paraXml = para[0];
    // Merge all <w:t> text within this paragraph
    WT_SCAN_RE.lastIndex = 0;
    let merged = '';
    let m: RegExpExecArray | null;
    while ((m = WT_SCAN_RE.exec(paraXml)) !== null) {
      merged += m[1];
    }
    if (merged) {
      all.push(...detectLatexInText(merged));
    }
  }

  return all;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function pipeline(
  inputPath: string,
  outputPath: string,
  onProgress: ProgressCallback = () => {},
): Promise<PipelineResult> {
  const t0 = Date.now();

  try {
    // ── Step 1: Unzip ──────────────────────────────────────────────────────
    onProgress({ status: 'scanning', total: 0, converted: 0, failed: 0 });
    const files = await unzipDocx(inputPath);

    const docXmlBuf = files.get('word/document.xml');
    if (!docXmlBuf) {
      throw new Error('Not a valid .docx: missing word/document.xml');
    }
    const documentXml = docXmlBuf.toString('utf-8');

    // ── Step 2: Collect all LaTeX ──────────────────────────────────────────
    const allMatches = collectAllLatex(documentXml);
    const unique = deduplicateLatex(allMatches);
    const total = unique.length;

    if (total === 0) {
      // Nothing to convert — copy file as-is
      const newFiles = new Map(files);
      await zipDocx(newFiles, outputPath);
      return {
        success: true,
        stats: { total: 0, converted: 0, failed: 0, durationMs: Date.now() - t0 },
      };
    }

    onProgress({ status: 'scanning', total, converted: 0, failed: 0 });

    // ── Step 3: Convert (parallel workers) ────────────────────────────────
    const cache = await convertBatch(unique, onProgress);

    const converted = cache.size;
    const failed = total - converted;

    // ── Step 4: Replace in XML ─────────────────────────────────────────────
    onProgress({ status: 'replacing', total, converted, failed });
    const { xml: newXml } = replaceLatexInXml(documentXml, cache);

    // ── Step 5: Zip output ─────────────────────────────────────────────────
    onProgress({ status: 'zipping', total, converted, failed });
    const newFiles = new Map(files);
    newFiles.set('word/document.xml', Buffer.from(newXml, 'utf-8'));
    await zipDocx(newFiles, outputPath);

    onProgress({ status: 'done', total, converted, failed });

    return {
      success: true,
      stats: { total, converted, failed, durationMs: Date.now() - t0 },
    };
  } catch (e) {
    const message = (e as Error).message;
    onProgress({ status: 'error', total: 0, converted: 0, failed: 0, message });
    return {
      success: false,
      stats: { total: 0, converted: 0, failed: 0, durationMs: Date.now() - t0 },
      error: message,
    };
  }
}
