/**
 * unzip.ts
 * Extracts all files from a .docx (ZIP) archive into a Map<path, Buffer>.
 */

import * as yauzl from 'yauzl';

/**
 * Extract all entries from a .docx file.
 * Returns a Map where keys are file paths (e.g. "word/document.xml")
 * and values are the raw file contents as Buffers.
 */
export function unzipDocx(filePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, Buffer>();

    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        // Skip directory entries
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return reject(streamErr);

          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zipfile.readEntry();
          });
          readStream.on('error', reject);
        });
      });

      zipfile.on('end', () => resolve(files));
      zipfile.on('error', reject);
    });
  });
}
