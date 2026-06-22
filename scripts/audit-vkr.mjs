/**
 * Аудит сохранённого HTML/JSON документа или последнего test-run.
 * Usage: node scripts/audit-vkr.mjs [path-to.json|html]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditVkrDocument } from '../src/vkrAudit.js';
import { htmlToBlocks } from '../src/htmlToBlocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function latestTestRun() {
  const dir = path.join(__dirname, '..', 'data', 'test-runs');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function main() {
  const arg = process.argv[2] || latestTestRun();
  if (!arg) {
    console.error('No file. Run run-pedagogy-vkr.mjs first.');
    process.exit(1);
  }

  let blocks; let outline; let sources;
  if (arg.endsWith('.json')) {
    const d = JSON.parse(fs.readFileSync(arg, 'utf8'));
    outline = d.outline;
    sources = d.sources;
    const htmlPath = arg.replace(/\.json$/, '.html');
    if (fs.existsSync(htmlPath)) {
      blocks = htmlToBlocks(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      console.error('Missing paired HTML:', htmlPath);
      process.exit(1);
    }
  } else {
    blocks = htmlToBlocks(fs.readFileSync(arg, 'utf8'));
  }

  const report = auditVkrDocument({
    blocks,
    outline: outline || {},
    research: { domain: 'pedagogy' },
    cfg: { minRefs: 28, minTables: 3 },
    sources: sources || {},
  });

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
