/**
 * cli.ts
 * Command-line interface for testing the conversion pipeline.
 *
 * Usage:
 *   node dist/cli.js input.docx output.docx
 *   node dist/cli.js input.docx               (output = input_converted.docx)
 */

import { pipeline } from './core/pipeline';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node dist/cli.js <input.docx> [output.docx]');
    process.exit(1);
  }

  const inputPath  = args[0];
  const outputPath = args[1] ?? inputPath.replace(/\.docx$/i, '_converted.docx');

  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log('');

  const result = await pipeline(inputPath, outputPath, (info) => {
    const bar = '█'.repeat(Math.round((info.converted / Math.max(info.total, 1)) * 20));
    const empty = '░'.repeat(20 - bar.length);
    const pct = info.total > 0 ? Math.round((info.converted / info.total) * 100) : 0;
    process.stdout.write(
      `\r[${bar}${empty}] ${pct}%  ${info.converted}/${info.total} converted  ${info.failed} failed  (${info.status})  `,
    );
  });

  console.log('\n');

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  const { total, converted, failed, durationMs } = result.stats;
  console.log('─'.repeat(50));
  console.log(`Total equations:  ${total}`);
  console.log(`Converted:        ${converted}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Duration:         ${durationMs} ms`);
  console.log('─'.repeat(50));
  console.log(`Output: ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
