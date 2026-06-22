/**
 * Тестовая генерация педагогической ВКР + аудит качества.
 * Usage: node scripts/run-pedagogy-vkr.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDocument } from '../src/generator.js';
import { auditVkrDocument } from '../src/vkrAudit.js';
import { blocksToHtml } from '../src/blocksToHtml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'data', 'test-runs');

const TOPIC = 'Посткроссинг как средство развития познавательного интереса дошкольников';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const started = Date.now();
  console.log('[test] topic:', TOPIC);
  console.log('[test] model:', process.env.OPENROUTER_MODEL || '(default)');

  let lastProgress = 0;
  const result = await generateDocument(
    { topic: TOPIC, workType: 'vkr', meta: {} },
    (ev) => {
      if ((ev.progress || 0) >= lastProgress + 5 || ev.progress >= 99) {
        lastProgress = ev.progress || lastProgress;
        console.log(`[${ev.progress || 0}%] ${ev.message || ev.stage || ''}`);
      }
    },
  );

  const audit = auditVkrDocument({
    blocks: result.blocks,
    outline: result.outline,
    research: { domain: 'pedagogy' },
    cfg: { minRefs: 28, minTables: 3 },
    sources: result.sources,
  });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(OUT_DIR, `postcrossing-${ts}`);
  const html = blocksToHtml(result.blocks);

  fs.writeFileSync(`${base}.json`, JSON.stringify({ outline: result.outline, audit, sources: result.sources }, null, 2));
  fs.writeFileSync(`${base}.html`, html);

  const plain = result.blocks
    .filter((b) => b.kind === 'p' || b.kind === 'h1' || b.kind === 'h2')
    .map((b) => b.text)
    .join(' ');
  const words = plain.split(/\s+/).filter(Boolean).length;
  const refs = result.blocks.filter((b) => b.kind === 'ref').length;
  const tables = result.blocks.filter((b) => b.kind === 'table').length;

  console.log('\n========== RESULT ==========');
  console.log('words:', words, '| refs:', refs, '| tables:', tables);
  console.log('audit:', audit.pass ? 'PASS' : 'FAIL');
  if (!audit.pass) console.log('issues:', audit.issues.join('\n  - '));
  console.log('elapsed:', Math.round((Date.now() - started) / 1000), 's');
  console.log('saved:', base + '.{json,html}');

  process.exit(audit.pass ? 0 : 1);
}

main().catch((e) => {
  console.error('[test] FAILED:', e.message);
  process.exit(1);
});
