/**
 * latexToImage.ts
 * Renders LaTeX expressions to PNG using KaTeX + Puppeteer (optional dependency).
 *
 * This is a fallback path for LaTeX that cannot be reliably converted to OMML.
 * Requires puppeteer-core to be installed AND a Chromium-compatible browser:
 *   - Electron context: uses Electron's built-in Chromium automatically
 *   - Node.js CLI: looks for Chrome/Chromium in common Windows locations
 *
 * If puppeteer-core is not installed or no browser is found, latexToPng()
 * returns null and image fallback is silently skipped (pipeline degrades gracefully).
 *
 * Install: pnpm add puppeteer-core
 */

import katex from 'katex';
import * as fs from 'fs';
import * as path from 'path';

/** Puppeteer deviceScaleFactor for high-DPI screenshots */
const DEVICE_SCALE = 2;

export interface PngResult {
  buffer: Buffer;
  /** Logical CSS pixel width (before device scale, use for EMU conversion) */
  width: number;
  /** Logical CSS pixel height (before device scale, use for EMU conversion) */
  height: number;
}

// Global browser instance reused across calls for performance
let _browser: any = null;
let _browserLaunchFailed = false;

// ── Browser discovery ──────────────────────────────────────────────────────────

/**
 * Find a Chromium-compatible browser executable.
 * Priority: Electron's built-in Chromium > system Chrome.
 */
function findBrowserExecutable(): string | null {
  // 1. Electron context: require('electron') returns the path to the electron binary
  try {
    const ep: unknown = (require as any)('electron');
    if (typeof ep === 'string' && ep.length > 0) {
      try {
        if (fs.existsSync(ep)) return ep;
      } catch { /* skip */ }
    }
  } catch { /* not in Electron */ }

  // 2. Common Chrome/Chromium paths on Windows
  const candidates: string[] = [
    ...(process.env.LOCALAPPDATA
      ? [path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')]
      : []),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* skip */ }
  }
  return null;
}

async function getBrowser(): Promise<any | null> {
  if (_browser) return _browser;
  if (_browserLaunchFailed) return null;

  // Dynamically require so missing package doesn't break the build/import
  let puppeteer: any;
  try {
    puppeteer = (require as any)('puppeteer-core');
  } catch {
    _browserLaunchFailed = true;
    return null; // puppeteer-core not installed — image fallback disabled
  }

  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    _browserLaunchFailed = true;
    return null; // no browser found — image fallback disabled
  }

  try {
    _browser = await puppeteer.launch({
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
      ],
      headless: true,
    });
    return _browser;
  } catch {
    _browserLaunchFailed = true;
    return null;
  }
}

/** Close the shared browser (call on app shutdown to free resources). */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
  }
}

// ── KaTeX CSS path ─────────────────────────────────────────────────────────────

/**
 * Locate the KaTeX CSS file for correct font rendering in the headless browser.
 * Without this, Puppeteer will still render the math but with fallback fonts.
 */
function findKatexCssPath(): string | null {
  const candidates = [
    // From dist/core/ → project root node_modules
    path.join(__dirname, '..', '..', '..', 'node_modules', 'katex', 'dist', 'katex.min.css'),
    // From process.cwd() (typically the project root)
    path.join(process.cwd(), 'node_modules', 'katex', 'dist', 'katex.min.css'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* skip */ }
  }
  return null;
}

// ── PNG rendering ──────────────────────────────────────────────────────────────

/**
 * Render a LaTeX expression to a PNG buffer via Puppeteer + KaTeX.
 *
 * Returns null when rendering is unavailable (no browser, rendering error, etc.).
 * The caller must handle null and fall back to keeping the original LaTeX text.
 */
export async function latexToPng(latex: string, displayMode: boolean): Promise<PngResult | null> {
  const browser = await getBrowser();
  if (!browser) return null;

  let page: any = null;
  try {
    // KaTeX renders the LaTeX to HTML in Node.js (no browser needed for this step)
    const renderedHtml = katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      output: 'html',
    });

    const pageHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: white; display: inline-block; }
#math {
  display: inline-block;
  padding: 4px 8px;
  font-size: 16px;
  line-height: 1.4;
  white-space: nowrap;
}
</style>
</head>
<body><div id="math">${renderedHtml}</div></body>
</html>`;

    page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 400, deviceScaleFactor: DEVICE_SCALE });
    await page.setContent(pageHtml, { waitUntil: 'domcontentloaded' });

    // Add KaTeX CSS so math fonts render correctly
    const cssPath = findKatexCssPath();
    if (cssPath) {
      await page.addStyleTag({ path: cssPath });
    }

    const element = await page.$('#math');
    if (!element) return null;

    // boundingBox returns logical CSS pixels (not scaled by deviceScaleFactor)
    const box = await element.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) return null;

    const screenshot = await element.screenshot({ type: 'png' }) as Buffer;

    return {
      buffer: screenshot,
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    };
  } catch {
    return null;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }
}
