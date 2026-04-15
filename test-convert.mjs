/**
 * Quick test: convert specific LaTeX expressions and print OMML.
 */
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, 'dist/core/worker.js');

const testExpressions = [
  { latex: '\\int_{0}^{1}2m dx = 4', displayMode: false },
  { latex: 'm', displayMode: false },
  { latex: '{{1}}', displayMode: false },
  { latex: '{{2}}', displayMode: false },
  { latex: '\\int_{0}^{1}2m dx = \\left. 2mx \\right|_{0}^{1} = 2m', displayMode: false },
  { latex: '2m = 4 \\Rightarrow m = 2', displayMode: false },
  { latex: '\\int_{0}^{1}2m dx = \\left. 2mx \\right|_{0}^{1}', displayMode: false },
];

function runWorker(batch) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { batch } });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

const results = await runWorker(testExpressions);
for (const r of results) {
  console.log('=== LaTeX:', r.latex);
  if (r.error) {
    console.log('ERROR:', r.error);
  } else {
    console.log('OMML:', r.omml);
  }
  console.log();
}
