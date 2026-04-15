/**
 * Creates a minimal test docx file with the user's Vietnamese math content
 */
import * as yazl from './node_modules/.pnpm/yazl@3.3.1/node_modules/yazl/index.js';
import * as fs from 'fs';

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

// Helper to create a paragraph with text
function para(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">
<w:body>
${para('Câu 1: [MỨC 1] Nếu $\\int_{0}^{1}2m dx = 4$ thì giá trị của $m$ là:')}
${para('A. ${{1}}$ B. ${{2}}$ C. ${{3}}$ D. ${{4}}$')}
${para('Lời giải:')}
${para('Ta có $\\int_{0}^{1}2m dx = \\left. 2mx \\right|_{0}^{1} = 2m$.')}
${para('Theo giả thiết $2m = 4 \\Rightarrow m = 2$.')}
</w:body>
</w:document>`;

function zipDocx(files, outputPath) {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();

    const entries = [...files.entries()].sort(([a], [b]) => {
      const priority = (p) =>
        p === '[Content_Types].xml' ? 0 :
        p.startsWith('_rels/') ? 1 :
        p.endsWith('.rels') ? 2 : 3;
      return priority(a) - priority(b);
    });

    for (const [name, content] of entries) {
      const buf = Buffer.from(content, 'utf-8');
      zipfile.addBuffer(buf, name, { mtime: new Date('2024-01-01') });
    }

    zipfile.end();
    const outStream = fs.createWriteStream(outputPath);
    zipfile.outputStream.pipe(outStream);
    outStream.on('finish', resolve);
    outStream.on('error', reject);
    zipfile.outputStream.on('error', reject);
  });
}

const files = new Map([
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rels],
  ['word/_rels/document.xml.rels', wordRels],
  ['word/document.xml', document],
]);

await zipDocx(files, 'test/vietnamese-math.docx');
console.log('Created test/vietnamese-math.docx');
console.log('Document XML preview:');
console.log(document.slice(0, 500));
