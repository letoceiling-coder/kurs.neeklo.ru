/**
 * Проверка соответствия ВКР требованиям (лист соответствия).
 * Usage: node scripts/compliance-check.mjs [docId|path-to.html|path-to.json]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from '../src/store.js';
import { htmlToBlocks } from '../src/htmlToBlocks.js';
import { checkVkrCompliance } from '../src/vkrCompliance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFromArg(arg) {
  if (arg && /^[a-f0-9-]{36}$/i.test(arg)) {
    const doc = getDocument(arg);
    if (!doc) throw new Error(`Документ не найден: ${arg}`);
    return {
      blocks: htmlToBlocks(doc.html || ''),
      outline: doc.outline || {},
      sources: doc.sources || {},
      title: doc.title,
    };
  }
  if (!arg) throw new Error('Укажите docId или путь к .html / .json');
  const p = path.resolve(arg);
  if (p.endsWith('.html')) {
    return { blocks: htmlToBlocks(fs.readFileSync(p, 'utf8')), outline: {}, sources: {} };
  }
  if (p.endsWith('.json')) {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const htmlPath = p.replace(/\.json$/, '.html');
    if (!fs.existsSync(htmlPath)) throw new Error(`Нет HTML: ${htmlPath}`);
    return {
      blocks: htmlToBlocks(fs.readFileSync(htmlPath, 'utf8')),
      outline: d.outline || {},
      sources: d.sources || {},
    };
  }
  throw new Error('Формат: docId, .html или .json');
}

function main() {
  const arg = process.argv[2];
  const data = loadFromArg(arg);
  const report = checkVkrCompliance({
    blocks: data.blocks,
    outline: data.outline,
    research: { domain: 'pedagogy' },
    cfg: { minRefs: 40, minTables: 3 },
    sources: data.sources,
  });

  console.log('\n========== СООТВЕТСТВИЕ ВКР ==========');
  if (data.title) console.log('Документ:', data.title);
  console.log('Объём:', report.stats.pagesEst, 'стр.,', report.stats.words, 'слов');
  console.log('Источники:', report.stats.refs, '| Таблицы:', report.stats.tables);
  console.log('Итог:', report.pass ? 'СООТВЕТСТВУЕТ' : 'ЕСТЬ ЗАМЕЧАНИЯ');
  console.log('\n--- Объём и структура ---');
  for (const c of report.volumeChecks) {
    console.log(c.ok ? '✓' : '✗', c.label, '—', c.value ?? '');
  }
  console.log('\n--- Введение ---');
  for (const c of report.introChecks) {
    console.log(c.ok ? '✓' : '✗', c.label);
  }
  if (report.chapterBalance.length) {
    console.log('\n--- Баланс глав ---');
    for (const c of report.chapterBalance) {
      console.log(c.ok ? '✓' : '✗', c.chapter, '—', c.pages, 'стр., откл.', c.deviationPct + '%');
    }
  }
  console.log('\n--- Оформление (экспорт DOCX/PDF) ---');
  for (const f of report.formatting) {
    console.log(f.ok ? '✓' : '✗', f.label, f.note ? `(${f.note})` : '');
  }
  if (report.failed.length) {
    console.log('\n--- Не пройдено ---');
    report.failed.forEach((x) => console.log('•', x));
  }
  console.log('\n========================================\n');
  process.exit(report.pass ? 0 : 1);
}

main();
