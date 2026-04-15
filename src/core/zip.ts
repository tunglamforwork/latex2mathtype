/**
 * zip.ts
 * Creates a new .docx (ZIP) file from a Map<path, Buffer>.
 */

import * as yazl from 'yazl';
import * as fs from 'fs';
import { Readable } from 'stream';

/**
 * Write a Map<path, Buffer> as a ZIP file (suitable for .docx).
 * Preserves [Content_Types].xml and _rels/ as-is.
 */
export function zipDocx(files: Map<string, Buffer>, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();

    // Sort entries: put [Content_Types].xml and _rels first (Word requires it)
    const entries = [...files.entries()].sort(([a], [b]) => {
      const priority = (p: string) =>
        p === '[Content_Types].xml' ? 0 :
        p.startsWith('_rels/') ? 1 :
        p.endsWith('.rels') ? 2 : 3;
      return priority(a) - priority(b);
    });

    for (const [name, buf] of entries) {
      zipfile.addBuffer(buf, name, {
        compress: shouldCompress(name),
        mtime: new Date('2024-01-01'),
      });
    }

    zipfile.end();

    const outStream = fs.createWriteStream(outputPath);
    zipfile.outputStream.pipe(outStream);

    outStream.on('finish', resolve);
    outStream.on('error', reject);
    zipfile.outputStream.on('error', reject);
  });
}

/** Don't compress media files (already compressed) or very small files */
function shouldCompress(fileName: string): boolean {
  const noCompress = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.wmf', '.emf'];
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return !noCompress.includes(ext);
}
