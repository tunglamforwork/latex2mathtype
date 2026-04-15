/**
 * Create a sample test .docx with various LaTeX equations.
 * Run: node scripts/create-sample.mjs
 *
 * Produces: test/sample.docx
 */

import { ZipFile } from '../node_modules/.pnpm/yazl@3.3.1/node_modules/yazl/index.js';
import { mkdirSync, createWriteStream } from 'fs';

mkdirSync('test', { recursive: true });

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

// Sample equations in various formats
const equations = [
  { text: 'Inline fraction: $\\frac{1}{2}$ and $\\frac{a+b}{c-d}$', para: true },
  { text: 'Pythagorean theorem: $a^2 + b^2 = c^2$', para: true },
  { text: 'Subscript example: $x_{n+1} = x_n - \\frac{f(x_n)}{f\'(x_n)}$', para: true },
  { text: 'Greek letters: $\\alpha + \\beta = \\gamma$', para: true },
  { text: 'Display equation:', para: true },
  { text: '$$E = mc^2$$', para: true },
  { text: 'Square root: $\\sqrt{x^2 + y^2}$', para: true },
  { text: 'Nested fraction: $\\frac{\\frac{a}{b}}{\\frac{c}{d}}$', para: true },
  { text: 'Sub and superscript: $x_i^2$', para: true },
  { text: 'Display with limits:', para: true },
  { text: '$$\\sum_{i=1}^{n} x_i = \\frac{n(n+1)}{2}$$', para: true },
  { text: 'Inline with parens: $\\left(x + y\\right)^2 = x^2 + 2xy + y^2$', para: true },
  { text: 'Multiple in one paragraph: $a^2$ and $b_0$ and $\\frac{p}{q}$', para: true },
  // Same equation twice (tests deduplication)
  { text: 'Repeated: $\\alpha + \\beta = \\gamma$', para: true },
];

function makeTextPara(text) {
  const xmlText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `  <w:p>
    <w:r>
      <w:t xml:space="preserve">${xmlText}</w:t>
    </w:r>
  </w:p>`;
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>LaTeX Equation Test Document</w:t></w:r>
    </w:p>
${equations.map(e => makeTextPara(e.text)).join('\n')}
    <w:sectPr/>
  </w:body>
</w:document>`;

// Create a .docx with split runs to test merging
const splitRunXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">The equation </w:t></w:r>
      <w:r><w:t>$x</w:t></w:r>
      <w:r><w:t>^</w:t></w:r>
      <w:r><w:t xml:space="preserve">2$</w:t></w:r>
      <w:r><w:t xml:space="preserve"> is quadratic.</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

function buildDocx(docXml, outputPath) {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const buf = s => Buffer.from(s, 'utf-8');

    zip.addBuffer(buf(contentTypes), '[Content_Types].xml');
    zip.addBuffer(buf(rels), '_rels/.rels');
    zip.addBuffer(buf(wordRels), 'word/_rels/document.xml.rels');
    zip.addBuffer(buf(docXml), 'word/document.xml');
    zip.end();

    const out = createWriteStream(outputPath);
    zip.outputStream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

await buildDocx(documentXml, 'test/sample.docx');
console.log('Created test/sample.docx');

await buildDocx(splitRunXml, 'test/split-runs.docx');
console.log('Created test/split-runs.docx');
