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
import { XMLValidator } from 'fast-xml-parser';
import { unzipDocx } from './unzip';
import { zipDocx } from './zip';
import { applyMathTypeToDocx } from './mathtype';
import { detectLatexInText, LatexMatch } from './detectLatex';
import { deduplicateLatex, splitIntoBatches, UniqueLatex } from './dedupe';
import { replaceLatexInXml, ReplaceStats, ImageCache, ImageCacheEntry } from './replace';
import { WorkerResult } from './worker';
import { latexToPng, closeBrowser } from './convert/latexToImage';

export interface ProgressInfo {
  status: 'scanning' | 'converting' | 'replacing' | 'zipping' | 'postprocessing' | 'done' | 'error';
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
  warning?: string;
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

  // Decode XML entities from regex-captured text
  const xmlDec = (s: string) => s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  while ((para = PARA_SCAN_RE.exec(documentXml)) !== null) {
    const paraXml = para[0];
    // Merge all <w:t> text within this paragraph
    WT_SCAN_RE.lastIndex = 0;
    let merged = '';
    let m: RegExpExecArray | null;
    while ((m = WT_SCAN_RE.exec(paraXml)) !== null) {
      merged += xmlDec(m[1]);
    }
    if (merged) {
      all.push(...detectLatexInText(merged));
    }
  }

  return all;
}

// ── Image fallback ─────────────────────────────────────────────────────────────

/** 1 CSS pixel at 96 DPI = 9525 EMU (914400 EMU / 96 px/inch) */
const PX_TO_EMU = 9525;

/**
 * Render failed equations as PNG images and patch the DOCX files map.
 *
 * For each equation that workers could not convert to OMML:
 *  1. Render LaTeX → PNG via Puppeteer (if available)
 *  2. Add PNG to word/media/ in the files map
 *  3. Add image relationship to word/_rels/document.xml.rels
 *  4. Record the rId + dimensions in the imageCache
 *
 * Returns an ImageCache ready to pass to replaceLatexInXml.
 * If Puppeteer is unavailable, returns an empty cache (equations stay as text).
 */
async function buildImageFallback(
  failed: UniqueLatex[],
  files: Map<string, Buffer>,
): Promise<ImageCache> {
  const imageCache: ImageCache = new Map();
  if (failed.length === 0) return imageCache;

  const newRelEntries: string[] = [];

  for (let i = 0; i < failed.length; i++) {
    const { latex, displayMode } = failed[i];

    const png = await latexToPng(latex, displayMode);
    if (!png) continue; // no browser or render error — skip this equation

    const filename = `eq_fallback_${i}.png`;
    const rId = `rIdEq${i + 1}`;
    const docPrId = 10000 + i;

    // Store PNG in DOCX media folder
    files.set(`word/media/${filename}`, png.buffer);

    // Collect the new relationship entry
    newRelEntries.push(
      `<Relationship Id="${rId}" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
      `Target="media/${filename}"/>`,
    );

    imageCache.set(latex, {
      rId,
      widthEmu: png.width * PX_TO_EMU,
      heightEmu: png.height * PX_TO_EMU,
      docPrId,
    });
  }

  if (newRelEntries.length === 0) return imageCache;

  // Patch word/_rels/document.xml.rels with new image relationships
  const RELS_PATH = 'word/_rels/document.xml.rels';
  const existingRelsBuf = files.get(RELS_PATH);

  let relsXml: string;
  if (existingRelsBuf) {
    relsXml = existingRelsBuf.toString('utf-8');
  } else {
    // Create a minimal rels file if missing (unusual but defensive)
    relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '</Relationships>';
  }

  const injection = '\n  ' + newRelEntries.join('\n  ');
  relsXml = relsXml.replace(/<\/Relationships>/, `${injection}\n</Relationships>`);
  files.set(RELS_PATH, Buffer.from(relsXml, 'utf-8'));

  return imageCache;
}

// ── XML safety checks ──────────────────────────────────────────────────────────

const INVALID_XML_CHAR_RE = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g;

function sanitizeAndValidateDocumentXml(documentXml: string): string {
  const sanitized = documentXml.replace(INVALID_XML_CHAR_RE, '');
  const validation = XMLValidator.validate(sanitized);
  if (validation !== true) {
    const err = validation.err;
    throw new Error(
      `Invalid document.xml after conversion at line ${err.line}, col ${err.col}: ${err.msg}`,
    );
  }
  return sanitized;
}

async function applyMathTypeWithProgress(
  outputPath: string,
  total: number,
  converted: number,
  failed: number,
  onProgress: ProgressCallback,
): Promise<Awaited<ReturnType<typeof applyMathTypeToDocx>>> {
  const started = Date.now();
  onProgress({
    status: 'postprocessing',
    total,
    converted,
    failed,
    message: 'Applying MathType format…',
  });

  const timer = setInterval(() => {
    const elapsedSec = Math.max(1, Math.floor((Date.now() - started) / 1000));
    onProgress({
      status: 'postprocessing',
      total,
      converted,
      failed,
      message: `Applying MathType format… ${elapsedSec}s`,
    });
  }, 1000);

  try {
    return await applyMathTypeToDocx(outputPath);
  } finally {
    clearInterval(timer);
  }
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
      const mt = await applyMathTypeWithProgress(outputPath, 0, 0, 0, onProgress);
      onProgress({ status: 'done', total: 0, converted: 0, failed: 0 });
      return {
        success: true,
        stats: { total: 0, converted: 0, failed: 0, durationMs: Date.now() - t0 },
        warning: mt.applied
          ? mt.details
          : `MathType post-process failed; output remains OMML equations. ${mt.error ?? ''}`.trim(),
      };
    }

    onProgress({ status: 'scanning', total, converted: 0, failed: 0 });

    // ── Step 3: Convert (parallel workers) ────────────────────────────────
    const ommlCache = await convertBatch(unique, onProgress);

    const ommlConverted = ommlCache.size;
    const failedEquations = unique.filter(u => !ommlCache.has(u.latex));

    // ── Step 3b: Image fallback for equations workers could not convert ────
    // newFiles is mutable — buildImageFallback adds media files and patches rels
    const newFiles = new Map(files);
    const imageCache = await buildImageFallback(failedEquations, newFiles);

    // Close headless browser now that all images are rendered
    await closeBrowser();

    const converted = ommlConverted + imageCache.size;
    const failed = total - converted;

    // ── Step 4: Replace in XML ─────────────────────────────────────────────
    onProgress({ status: 'replacing', total, converted, failed });
    const { xml: newXml } = replaceLatexInXml(documentXml, ommlCache, imageCache);
    const safeXml = sanitizeAndValidateDocumentXml(newXml);

    // ── Step 5: Zip output ─────────────────────────────────────────────────
    onProgress({ status: 'zipping', total, converted, failed });
    newFiles.set('word/document.xml', Buffer.from(safeXml, 'utf-8'));
    await zipDocx(newFiles, outputPath);

    // ── Step 6: Post-process with MathType (Word automation) ───────────────
    const mt = await applyMathTypeWithProgress(outputPath, total, converted, failed, onProgress);

    onProgress({ status: 'done', total, converted, failed });

    return {
      success: true,
      stats: { total, converted, failed, durationMs: Date.now() - t0 },
      warning: mt.applied
        ? mt.details
        : `MathType post-process failed; output remains OMML equations. ${mt.error ?? ''}`.trim(),
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
