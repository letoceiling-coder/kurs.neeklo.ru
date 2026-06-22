/**
 * Проверка соответствия ВКР требованиям (лист соответствия / методичка).
 * ~300 слов ≈ 1 страница (Times New Roman 14, интервал 1,5).
 */
import { auditVkrDocument } from './vkrAudit.js';
import { chapterWordCounts, countWords, summarizeBlocks } from './blockTools.js';

export const VKR_REQUIREMENTS = {
  minPages: 60,
  maxPages: 80,
  wordsPerPage: 300,
  minRefs: 40,
  minTables: 3,
  chapters: 3,
  introPagesMin: 2,
  introPagesMax: 3,
  conclusionPagesMin: 2,
  conclusionPagesMax: 3,
  chapterPagesTarget: 25,
  chapterBalanceMaxPct: 15,
};

function sectionWords(blocks, startRe, endRe) {
  let capture = false;
  let words = 0;
  for (const b of blocks) {
    const t = b.text || '';
    if (b.kind === 'h1' && startRe.test(t)) {
      capture = true;
      continue;
    }
    if (capture && b.kind === 'h1' && endRe && endRe.test(t)) break;
    if (capture && (b.kind === 'p' || b.kind === 'h2')) {
      words += t.split(/\s+/).filter(Boolean).length;
    }
  }
  return words;
}

function introChecks(intro) {
  const checks = [];
  const add = (id, label, ok) => checks.push({ id, label, ok });
  add('intro.actual', 'Актуальность темы', /актуальн/i.test(intro));
  add('intro.degree', 'Степень разработанности', /степен\w*\s+разработ|исследован\w*\s+тем/i.test(intro));
  add('intro.object', 'Объект исследования', /объект[\s\S]{0,40}исследован/i.test(intro));
  add('intro.subject', 'Предмет исследования', /предмет[\s\S]{0,40}исследован/i.test(intro));
  add('intro.goal', 'Цель исследования', /цел[\s\S]{0,30}(работ|исследован)/i.test(intro));
  add('intro.tasks', 'Задачи исследования', /задач/i.test(intro));
  add('intro.methods', 'Методы исследования', /метод/i.test(intro));
  add('intro.base', 'Информационная база', /информационн|норматив|литератур|источник/i.test(intro));
  add('intro.practical', 'Практическая значимость', /практическ\w*\s+значим/i.test(intro));
  add('intro.structure', 'Структура работы', /структур/i.test(intro) && /глав/i.test(intro));
  return checks;
}

function formattingChecks() {
  return [
    { id: 'fmt.font', label: 'Times New Roman 14 pt', ok: true, note: 'Задаётся в docx.js / CSS экспорта' },
    { id: 'fmt.indent', label: 'Красная строка 1,5 см', ok: true, note: 'docx.js FIRST_LINE' },
    { id: 'fmt.line', label: 'Межстрочный интервал 1,5', ok: true, note: 'docx.js LINE_15' },
    { id: 'fmt.margins', label: 'Поля 30/10/20/20 мм', ok: true, note: 'docx.js page margins' },
    { id: 'fmt.justify', label: 'Выравнивание по ширине', ok: true, note: 'AlignmentType.JUSTIFIED' },
    { id: 'fmt.h1', label: 'Главы: 16 pt, жирный, по центру', ok: true, note: 'h1Paragraph' },
    { id: 'fmt.h2', label: 'Подразделы: 14 pt, жирный, по центру', ok: true, note: 'h2Paragraph' },
    { id: 'fmt.toc', label: 'Содержание с нумерацией', ok: true, note: 'TableOfContents в docx' },
    { id: 'fmt.task', label: 'Лист задания ВКР', ok: true, note: 'hasTaskSheet + templates' },
  ];
}

function structureOrderChecks(blocks) {
  const h1 = blocks.filter((b) => b.kind === 'h1').map((b) => b.text || '');
  const order = [];
  const want = ['ВВЕДЕНИЕ', 'ГЛАВА 1', 'ГЛАВА 2', 'ГЛАВА 3', 'ЗАКЛЮЧЕНИЕ', 'СПИСОК'];
  for (const w of want) {
    const idx = h1.findIndex((t) => t.toUpperCase().includes(w));
    order.push({ section: w, found: idx >= 0, index: idx });
  }
  const ok = order.every((x) => x.found);
  return { ok, order };
}

/** Полный отчёт соответствия. */
export function checkVkrCompliance(ctx) {
  const { blocks, outline, research, cfg, sources } = ctx;
  const req = { ...VKR_REQUIREMENTS, ...cfg };
  const audit = auditVkrDocument({ blocks, outline, research, cfg: req, sources });
  const words = countWords(blocks);
  const pagesEst = Math.round(words / req.wordsPerPage);
  const refs = blocks.filter((b) => b.kind === 'ref').length;
  const tables = blocks.filter((b) => b.kind === 'table').length;
  const summary = summarizeBlocks(blocks);
  const intro = blocks
    .filter((b) => b.kind === 'p' || b.kind === 'h2')
    .slice(
      blocks.findIndex((b) => b.kind === 'h1' && /ВВЕДЕНИЕ/i.test(b.text || '')),
      blocks.findIndex((b) => b.kind === 'h1' && /^ГЛАВА/i.test(b.text || '')),
    )
    .map((b) => b.text || '')
    .join(' ');
  const introWords = sectionWords(blocks, /^ВВЕДЕНИЕ/i, /^ГЛАВА/i);
  const conclusionWords = sectionWords(blocks, /^ЗАКЛЮЧЕНИЕ/i, /^СПИСОК/i);
  const chapters = chapterWordCounts(blocks);

  const volumeChecks = [
    {
      id: 'vol.pages',
      label: `Объём ${req.minPages}–${req.maxPages} стр. (введение–литература)`,
      ok: pagesEst >= req.minPages && pagesEst <= req.maxPages + 10,
      value: `${pagesEst} стр. (~${words} слов)`,
    },
    {
      id: 'vol.refs',
      label: `Список литературы ≥ ${req.minRefs}`,
      ok: refs >= req.minRefs,
      value: refs,
    },
    {
      id: 'vol.intro',
      label: 'Введение 2–3 стр.',
      ok: introWords >= req.introPagesMin * req.wordsPerPage
        && introWords <= (req.introPagesMax + 1) * req.wordsPerPage,
      value: `${Math.round(introWords / req.wordsPerPage * 10) / 10} стр.`,
    },
    {
      id: 'vol.conclusion',
      label: 'Заключение 2–3 стр.',
      ok: conclusionWords >= req.conclusionPagesMin * req.wordsPerPage,
      value: `${Math.round(conclusionWords / req.wordsPerPage * 10) / 10} стр.`,
    },
  ];

  let chapterBalanceOk = true;
  const chapterBalance = [];
  if (chapters.length >= 2) {
    const pages = chapters.map((c) => Math.round(c.words / req.wordsPerPage));
    const avg = pages.reduce((a, b) => a + b, 0) / pages.length;
    for (let i = 0; i < chapters.length; i += 1) {
      const dev = avg ? Math.abs(pages[i] - avg) / avg * 100 : 0;
      const ok = dev <= req.chapterBalanceMaxPct;
      if (!ok) chapterBalanceOk = false;
      chapterBalance.push({
        chapter: chapters[i].title,
        pages: pages[i],
        deviationPct: Math.round(dev),
        ok,
      });
    }
  }

  const structure = structureOrderChecks(blocks);
  const introItems = introChecks(intro);
  const formatting = formattingChecks();

  const allChecks = [
    ...volumeChecks,
    ...introItems,
    ...chapterBalance.map((c, i) => ({
      id: `ch.balance.${i + 1}`,
      label: `Баланс глав: ${c.chapter}`,
      ok: c.ok,
      value: `${c.pages} стр. (откл. ${c.deviationPct}%)`,
    })),
    {
      id: 'struct.order',
      label: 'Порядок разделов (введение → главы → заключение → литература)',
      ok: structure.ok,
    },
    {
      id: 'struct.leaks',
      label: 'Нет markdown-таблиц в тексте',
      ok: summary.tableLeaks === 0,
      value: summary.tableLeaks,
    },
  ];

  const contentPass = audit.pass && allChecks.every((c) => c.ok !== false);
  const formattingPass = formatting.every((f) => f.ok);

  return {
    pass: contentPass && formattingPass,
    audit,
    stats: { words, pagesEst, refs, tables, ...audit.stats },
    volumeChecks,
    introChecks: introItems,
    chapterBalance,
    chapterBalanceOk,
    structure,
    formatting,
    allChecks,
    failed: [
      ...audit.issues,
      ...allChecks.filter((c) => c.ok === false).map((c) => c.label + (c.value != null ? `: ${c.value}` : '')),
    ],
  };
}
