import * as esbuild from './node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/lib/main.js';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const isWatch = process.argv.includes('--watch');

const sharedOptions = {
  bundle: true,
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

async function build() {
  // Ensure dist directories exist
  mkdirSync('dist/renderer', { recursive: true });
  mkdirSync('dist/core', { recursive: true });

  const contexts = await Promise.all([
    // Main process
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['src/main.ts'],
      outfile: 'dist/main.js',
      platform: 'node',
      target: 'node20',
      external: ['electron', 'puppeteer-core'],
      format: 'cjs',
    }),
    // Preload script
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['src/preload.ts'],
      outfile: 'dist/preload.js',
      platform: 'node',
      target: 'node20',
      external: ['electron', 'puppeteer-core'],
      format: 'cjs',
    }),
    // Renderer (browser context)
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['src/renderer/renderer.ts'],
      outfile: 'dist/renderer/renderer.js',
      platform: 'browser',
      target: 'chrome120',
      format: 'iife',
    }),
    // Worker thread (Node context, no electron)
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['src/core/worker.ts'],
      outfile: 'dist/core/worker.js',
      platform: 'node',
      target: 'node20',
      external: ['electron', 'puppeteer-core'],
      format: 'cjs',
    }),
    // CLI (optional)
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['src/cli.ts'],
      outfile: 'dist/cli.js',
      platform: 'node',
      target: 'node20',
      external: ['electron', 'puppeteer-core'],
      format: 'cjs',
    }),
  ]);

  if (isWatch) {
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('[build] watching for changes...');
  } else {
    await Promise.all(contexts.map(ctx => ctx.rebuild()));
    await Promise.all(contexts.map(ctx => ctx.dispose()));
  }

  // Copy static assets
  cpSync('src/renderer/index.html', 'dist/renderer/index.html');
  console.log('[build] done');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
