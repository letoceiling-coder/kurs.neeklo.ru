import { isPedagogyDomain } from './workDomain.js';
import { containsBannedPhrase } from './dataIntegrity.js';
import { hasMarkdownTableLeak, stripMarkdownTableLeaksInBlocks } from './blockTools.js';
import { VKR_REQUIREMENTS } from './vkrCompliance.js';

const IT_LEAK_RE = /\b(bpmn|uml|swot|erp|api[\s-]?gateway|бизнес[\s-]?процесс|rusprofile|audit-it|мал\w*\s+бизнес|архитектур\w*\s+(систем|модел|решени))/i;

function blocksToPlain(blocks) {
  return blocks
    .filter((b) => b.kind === 'p' || b.kind === 'h1' || b.kind === 'h2')
    .map((b) => b.text || '')
    .join(' ');
}

function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function sectionPlain(blocks, startRe, endRe) {
  const parts = [];
  let capture = false;
  for (const b of blocks) {
    const t = b.text || '';
    if (b.kind === 'h1' && startRe.test(t)) {
      capture = true;
      continue;
    }
    if (capture && b.kind === 'h1' && endRe && endRe.test(t)) break;
    if (capture && (b.kind === 'p' || b.kind === 'h2')) parts.push(t);
  }
  return parts.join(' ');
}

/** Аудит сгенерированной ВКР по чеклисту roadmap / эталона. */
export function auditVkrDocument({ blocks, outline, research, cfg, sources }) {
  const plain = blocksToPlain(blocks);
  const words = wordCount(plain);
  const refs = blocks.filter((b) => b.kind === 'ref').length;
  const tables = blocks.filter((b) => b.kind === 'table').length;
  const h1 = blocks.filter((b) => b.kind === 'h1').map((b) => b.text);
  const chapterConclusions = (plain.match(/выводы по главе/gi) || []).length;
  const pedagogy = isPedagogyDomain(research?.domain);
  const minRefs = cfg?.minRefs ?? VKR_REQUIREMENTS.minRefs;
  const minTables = cfg?.minTables ?? VKR_REQUIREMENTS.minTables;
  const minWords = cfg?.minWords ?? (VKR_REQUIREMENTS.minPages * VKR_REQUIREMENTS.wordsPerPage);

  const issues = [];

  if (words < minWords) issues.push(`Мало текста: ${words} слов (минимум ${minWords})`);
  if (refs < minRefs) issues.push(`Мало источников: ${refs} (минимум ${minRefs})`);
  if (tables < minTables) issues.push(`Мало таблиц: ${tables} (минимум ${minTables})`);
  if (!h1.some((t) => /ВВЕДЕНИЕ/i.test(t))) issues.push('Нет раздела ВВЕДЕНИЕ');
  if (!h1.some((t) => /ЗАКЛЮЧЕНИЕ/i.test(t))) issues.push('Нет раздела ЗАКЛЮЧЕНИЕ');
  if (!h1.some((t) => /СПИСОК ИСПОЛЬЗОВАННЫХ/i.test(t))) issues.push('Нет списка источников');
  if (chapterConclusions < (outline?.chapters?.length || 3)) {
    issues.push(`Мало выводов по главам: ${chapterConclusions}`);
  }

  const intro = sectionPlain(blocks, /^ВВЕДЕНИЕ/i, /^ГЛАВА/i);
  if (!/объект[\s\S]{0,30}исследован/i.test(intro)) issues.push('Во введении нет объекта исследования');
  if (!/предмет[\s\S]{0,30}исследован/i.test(intro)) issues.push('Во введении нет предмета исследования');
  if (!/цел[\s\S]{0,20}(работ|исследован)/i.test(intro)) issues.push('Во введении нет цели');
  if (!/задач/i.test(intro)) issues.push('Во введении нет задач');

  if (pedagogy) {
    if (!outline?.hypothesis) issues.push('В плане нет гипотезы');
    if (!/гипотез/i.test(intro)) issues.push('Во введении нет гипотезы');
    if (/бизнес[\s-]?процесс|мал\w*\s+бизнес/i.test(outline?.object || '')) {
      issues.push('Объект исследования похож на бизнес-кейс');
    }
    if (IT_LEAK_RE.test(plain)) issues.push('В тексте есть IT/бизнес-лексика (BPMN, SWOT, бизнес-процессы…)');

    const ch2 = sectionPlain(blocks, /^ГЛАВА 2/i, /^ГЛАВА 3|^ЗАКЛЮЧЕНИЕ/i);
    if (!/констат|диагност|исходн/i.test(ch2)) issues.push('Глава 2: нет констатирующего/диагностического этапа');
    if (!/формир|программ|опыт/i.test(ch2)) issues.push('Глава 2: нет формирующего этапа');
    if (!/контрол|повторн|итог/i.test(ch2)) issues.push('Глава 2: нет контрольного этапа');
    if (!/\bn\s*=\s*(2[5-9]|30)\b|28\s+дет|выборк/i.test(ch2)) {
      issues.push('Глава 2: нет выборки (n=25–30)');
    }
  }

  let banned = 0;
  for (const b of blocks) {
    if (b.kind === 'p' && containsBannedPhrase(b.text)) banned += 1;
  }
  if (banned) issues.push(`AI-клише в ${banned} абзаце(ах)`);

  const tableLeaks = blocks.filter(
    (b) => b.kind === 'p' && hasMarkdownTableLeak(b.text),
  ).length;
  if (tableLeaks) issues.push(`Markdown-таблицы в тексте: ${tableLeaks} абзац(ов)`);

  const pass = issues.length === 0;
  return {
    pass,
    issues,
    stats: {
      words,
      refs,
      tables,
      chapterConclusions,
      domain: research?.domain || 'unknown',
      verifiedSources: sources?.verified ?? 0,
    },
  };
}

/** Автоисправление блоков перед аудитом (markdown-таблицы в абзацах). */
export function autoFixBlocksForAudit(blocks) {
  return stripMarkdownTableLeaksInBlocks(blocks);
}

export function assertVkrQuality(ctx) {
  const fixedBlocks = autoFixBlocksForAudit(ctx.blocks);
  if (fixedBlocks !== ctx.blocks) {
    ctx.blocks.length = 0;
    ctx.blocks.push(...fixedBlocks);
  }
  const report = auditVkrDocument(ctx);
  console.log('[audit]', JSON.stringify(report.stats), report.pass ? 'PASS' : 'FAIL');
  if (!report.pass) {
    throw new Error(`Аудит качества не пройден: ${report.issues.join('; ')}`);
  }
  return report;
}
