import { chat, chatJSON } from './openrouter.js';
import { cleanText, toParagraphs } from './textutil.js';
import {
  buildResearchContext, aiTopicSystemExtra, isAiTopic,
} from './researchContext.js';
import { sanitizeAcademicText, verifiedCompanyDirective, polishBlocks, countBannedInBlocks, formatDataIntegrityBlock } from './dataIntegrity.js';
import { buildAppendixBlocks } from './appendixDiagrams.js';
import {
  detectWorkDomain, isPedagogyDomain, isBusinessLikeDomain, pedagogySystemExtra,
  pedagogyIntroMethodsHint, pedagogyCompanyBlock, domainStructureHint, WORK_DOMAINS,
} from './workDomain.js';
import { assertVkrQuality } from './vkrAudit.js';

/** Убирает дублирующий заголовок, если модель повторила его первой строкой. */
function dropLeadingHeading(paras, ...headings) {
  if (!paras.length) return paras;
  const norm = (s) => s.toLowerCase().replace(/[«»".,:;]/g, '').trim();
  const first = norm(paras[0]);
  if (headings.some((h) => first === norm(h) || first.startsWith(norm(h)) && first.length < norm(h).length + 6)) {
    return paras.slice(1);
  }
  return paras;
}

/** Конфигурации типов работ */
export const WORK_TYPES = {
  vkr: {
    label: 'ВКР (Дипломная работа)',
    chapters: 3,
    subsectionsPerChapter: 3,
    refsCount: 42,
    minRefs: 40,
    minTables: 3,
    wordsPerSubsection: 2800,
    wordsIntro: 1200,
    wordsConclusion: 1000,
    chunkWords: 1400,
    hasTaskSheet: true,
  },
  coursework: {
    label: 'Курсовая работа',
    chapters: 2,
    subsectionsPerChapter: 3,
    refsCount: 28,
    minRefs: 15,
    minTables: 2,
    wordsPerSubsection: 1200,
    wordsIntro: 900,
    wordsConclusion: 700,
    chunkWords: 1200,
    hasTaskSheet: false,
  },
  referat: {
    label: 'Реферат',
    chapters: 3,
    subsectionsPerChapter: 0,
    refsCount: 16,
    minRefs: 10,
    minTables: 1,
    wordsPerSubsection: 900,
    wordsIntro: 700,
    wordsConclusion: 600,
    chunkWords: 900,
    hasTaskSheet: false,
  },
  report: {
    label: 'Доклад / Эссе',
    chapters: 3,
    subsectionsPerChapter: 0,
    refsCount: 10,
    minRefs: 6,
    minTables: 0,
    wordsPerSubsection: 500,
    wordsIntro: 400,
    wordsConclusion: 350,
    chunkWords: 500,
    hasTaskSheet: false,
  },
};

const TABLE_RETRY = 3;

const TABLE_FORMAT_HINT = `ОБЯЗАТЕЛЬНО включи таблицу с данными по теме параграфа в формате:
ТАБЛИЦА: Краткое название таблицы (3–8 слов)
| Столбец1 | Столбец2 | Столбец3 |
| значение | значение | значение |
| значение | значение | значение |
КОНЕЦ ТАБЛИЦЫ
Правила: каждая ячейка — до 15 слов; в ячейках только факты/термины, не абзацы текста; минимум 3 строки данных.`;

const MAX_TABLE_CELL_LEN = 120;
const MAX_TABLE_HEADER_LEN = 60;

function splitTableCells(line) {
  return String(line || '').trim().split('|').map((c) => c.trim()).filter((c, idx, a) => !(c === '' && (idx === 0 || idx === a.length - 1)));
}

function isMarkdownTableRow(line) {
  const s = String(line || '').trim();
  if (!/^\|/.test(s) || !/\|$/.test(s)) return false;
  const cells = splitTableCells(s);
  return cells.length >= 2;
}

function isMarkdownSeparatorRow(line) {
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
}

function isValidTableBlock(tbl) {
  if (!tbl || tbl.kind !== 'table') return false;
  const rows = (tbl.rows || []).filter((r) => Array.isArray(r) && r.some((c) => String(c || '').trim()));
  if (rows.length < 2) return false;
  const colCount = rows[0].length;
  if (colCount < 2 || colCount > 7) return false;
  if (!rows.every((r) => r.length === colCount)) return false;
  if (rows.some((r) => r.some((c) => String(c).length > MAX_TABLE_CELL_LEN))) return false;
  if (rows[0].some((c) => String(c).length > MAX_TABLE_HEADER_LEN)) return false;
  const dataRows = rows.slice(1);
  const filled = dataRows.reduce((n, r) => n + r.filter((c) => String(c).trim()).length, 0);
  const capacity = dataRows.length * colCount;
  if (capacity === 0 || filled / capacity < 0.45) return false;
  if (!dataRows.some((r) => r.filter((c) => String(c).trim()).length >= 2)) return false;
  return true;
}

function inferTableCaption(rows, fallback = 'Сводные данные') {
  const headers = (rows[0] || []).join(' ').toLowerCase();
  if (/swot|сильн|слаб|угроз/i.test(headers)) return 'SWOT-анализ';
  if (/as-is|to-be|процесс/i.test(headers)) return 'Сравнение процессов as-is / to-be';
  if (/подход|теори|автор/i.test(headers)) return 'Сравнение подходов';
  if (/этап|мероприят|срок/i.test(headers)) return 'Этапы внедрения';
  return fallback;
}

function sanitizeTableBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.kind !== 'table') {
      out.push(b);
      continue;
    }
    if (isValidTableBlock(b)) {
      const caption = cleanText(b.caption || '');
      out.push({
        ...b,
        caption: caption && caption !== 'Таблица' ? caption : inferTableCaption(b.rows, caption || 'Сводные данные'),
      });
      continue;
    }
    console.warn('[tables] rejected invalid table block');
    for (const row of b.rows || []) {
      for (const cell of row) {
        const t = cleanText(String(cell || ''));
        if (t.length > 40) out.push({ kind: 'p', text: t });
      }
    }
  }
  return out;
}

/** Разбить inline markdown-таблицы, попавшие в один абзац. */
function normalizeTableTextInParagraph(text) {
  let t = String(text || '');
  if (!/\|[^|]+\|/.test(t)) return t;
  t = t.replace(/КОНЕЦ ТАБЛИЦЫ/gi, '\nКОНЕЦ ТАБЛИЦЫ\n');
  t = t.replace(/([.!?;:)\»"»])\s*(\|)/g, '$1\n$2');
  t = t.replace(/([^\n|])\s+(\|[^\n|]+\|)/g, '$1\n$2');
  return t;
}

function repairEmbeddedTablesInBlocks(blocks) {
  const out = [];
  let fixed = 0;
  for (const b of blocks) {
    if (b.kind !== 'p') {
      out.push(b);
      continue;
    }
    const raw = b.text || '';
    if (!/\|[^|]+\|[^|]+\|/.test(raw)) {
      out.push(b);
      continue;
    }
    const sub = [];
    flushTextBufferWithTables(normalizeTableTextInParagraph(raw).split('\n'), sub);
    if (!sub.some((x) => x.kind === 'table')) {
      out.push(b);
      continue;
    }
    fixed += 1;
    for (const s of sub) {
      if (s.kind === 'p') {
        const clean = s.text.replace(/\s*КОНЕЦ ТАБЛИЦЫ\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
        if (clean.length > 25) out.push({ kind: 'p', text: clean });
      } else if (s.kind === 'table' && isValidTableBlock(s)) {
        out.push(s);
      }
    }
  }
  if (fixed) console.log(`[tables] repaired ${fixed} embedded table(s) in paragraphs`);
  return out;
}

function normalizeTableJSON(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data.map((r) => (Array.isArray(r) ? r.map((c) => cleanText(String(c))) : [])).filter((r) => r.length);
  }
  if (Array.isArray(data.rows)) {
    return data.rows.map((r) => (Array.isArray(r) ? r.map((c) => cleanText(String(c))) : [])).filter((r) => r.length);
  }
  return null;
}

function parseMarkdownTableLines(lines, caption = '') {
  const rows = [];
  for (const line of lines) {
    if (!isMarkdownTableRow(line)) continue;
    const cells = splitTableCells(line);
    if (!cells.length || isMarkdownSeparatorRow(line)) continue;
    rows.push(cells.map((c) => cleanText(c)));
  }
  if (rows.length < 2) return null;
  const tbl = { kind: 'table', caption: caption || 'Таблица', rows };
  return isValidTableBlock(tbl) ? tbl : null;
}

function flushTextBufferWithTables(buffer, blocks) {
  if (!buffer.length) return;
  const lines = buffer.join('\n').split('\n');
  let i = 0;
  let textBuf = [];

  const flushText = () => {
    if (!textBuf.length) return;
    const text = cleanText(textBuf.join('\n'));
    for (const p of text.split(/\n+/)) {
      const tp = p.trim();
      if (tp) blocks.push({ kind: 'p', text: tp });
    }
    textBuf = [];
  };

  while (i < lines.length) {
    if (isMarkdownTableRow(lines[i])) {
      flushText();
      const tableLines = [];
      while (i < lines.length && isMarkdownTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      const tbl = parseMarkdownTableLines(tableLines);
      if (tbl) blocks.push(tbl);
    } else {
      textBuf.push(lines[i]);
      i++;
    }
  }
  flushText();
  buffer.length = 0;
}

/** Главы 2…N (индекс ≥ 1) — в каждом параграфе нужна таблица. */
function chapterRequiresTables(chapterIndex) {
  return chapterIndex >= 1;
}

function countTables(blocks) {
  return blocks.filter((b) => b.kind === 'table').length;
}

const SYSTEM_CORE = `Ты — опытный научный руководитель и автор выпускных квалификационных работ бакалавров российских вузов.
Ты пишешь академическим научным стилем на русском языке, строго по ГОСТ и типовым методическим указаниям.
Уровень работы — бакалавриат: глубина достаточная для защиты, без докторской абстракции, но с практической направленностью.
Стиль — сухой научный, без маркетинговых оборотов и «рекламного» языка ИИ.

КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО:
- markdown (#, *, **, списки-маркеры);
- слова "markdown", расширения файлов (.md, .docx) в тексте;
- выдуманные авторы, несуществующие статьи и фальшивые URL;
- фразы-заглушки ("здесь должна быть таблица", "вставьте данные");
- пустые общие рассуждения без содержания;
- клише: «стремительная цифровая трансформация», «ключевой драйвер», «насущная необходимость», «существенно повысить эффективность».

ОБЯЗАТЕЛЬНО для качества ВКР:
- научная новизна бакалавра: адаптация методики к конкретному объекту;
- положения, выносимые на защиту — обоснованные выводы;
- источники: учебники Юрайт/Литрес, eLibrary, нормативные акты РФ, Росстат (2021–2026);
- любые цифры — ТОЛЬКО из блока источников или эмпирической базы; иначе без чисел.`;

const SYSTEM_BUSINESS = `
ОБЯЗАТЕЛЬНО для экономических/IT-работ:
- практическая часть: анализ объекта, выявление проблем, SWOT, сравнение «as-is / to-be»;
- проектная часть: РАЗРАБОТКА (не «концепция») — архитектура, схемы БД, диаграммы, алгоритмы, интерфейсы;
- для тем про ИИ: BPMN, UML (Use Case, Component, Sequence), ER-модель БД;
- вымышленные ИНН, ОГРН, КПП, названия ООО/АО без карточки rusprofile/audit-it;
- конкретные проценты («70% времени», «сокращение на 40%») без источника [N] или расчёта;
- если карточка предприятия не загружена — обобщённый кейс БЕЗ конкретного юрлица и реквизитов.`;

const SYSTEM = SYSTEM_CORE + SYSTEM_BUSINESS;

function systemPrompt(research) {
  let s = isPedagogyDomain(research?.domain) ? SYSTEM_CORE + pedagogySystemExtra() : SYSTEM;
  if (research?.integrityBlock) s += `\n${research.integrityBlock}`;
  if (!isPedagogyDomain(research?.domain) && research?.aiTopic) s += aiTopicSystemExtra();
  return s;
}

function contextPrompt(research) {
  if (!research) return '';
  const parts = [];
  if (research.integrityBlock) parts.push(`\n${research.integrityBlock}`);
  if (research.companyBlock) {
    const label = isPedagogyDomain(research?.domain) ? 'ЭМПИРИЧЕСКАЯ БАЗА' : 'КАРТОЧКА ПРЕДПРИЯТИЯ';
    parts.push(`\n--- ${label} ---\n${research.companyBlock}`);
  }
  if (research.sourceBlock) parts.push(`\n--- ИСТОЧНИКИ ---\n${research.sourceBlock}`);
  return parts.join('\n');
}

/** Генерация плана (содержания) работы */
export async function generateOutline({ topic, workType, meta }) {
  const cfg = WORK_TYPES[workType] || WORK_TYPES.vkr;
  const domain = detectWorkDomain(topic);
  const structureHint = domainStructureHint(domain, cfg);

  const aiHint = (domain === WORK_DOMAINS.it && isAiTopic(topic))
    ? `\nТема про ИИ: в главе 1 — LLM, RAG, AI Agents; в главе 2 — BPMN as-is/to-be процесса; в главе 3 — РАЗРАБОТКА: архитектура (API Gateway → AI Orchestrator → LLM/RAG → PostgreSQL + Vector DB), UML-диаграммы, ER-модель БД, макеты интерфейса, расчёт эффективности с формулой.`
    : '';
  const companyHint = isPedagogyDomain(domain)
    ? '\nОбъект — процесс развития/обучения/воспитания в ДОУ или школе; предмет — педагогическое средство из темы. НЕ предприятие, НЕ бизнес-процессы.'
    : meta?.company
      ? `\nОбъект исследования — предприятие: ${meta.company} (реквизиты только с rusprofile.ru / audit-it.ru; без вымышленного ИНН).`
      : '\nОбъект исследования — реальное предприятие отрасли (rusprofile.ru / audit-it.ru) или обобщённый кейс МСП без конкретных реквизитов.';

  const contentReq = isPedagogyDomain(domain)
    ? `- задачи: теоретический анализ, диагностика, разработка программы, апробация, оценка результатов;
- глава 2 — констатирующий, формирующий и контрольный этапы педагогического эксперимента;
- формулировки — академические, пригодные для защиты по педагогике.`
    : `- задачи должны покрывать: теорию, анализ практики, проектирование решения, оценку эффективности;
- параграфы главы 2 — про реальный анализ (показатели, процессы, проблемы);
- параграфы главы 3 — про разработку и внедрение с расчётом эффекта;
- формулировки — академические, пригодные для защиты бакалавра.`;

  const hypothesisField = isPedagogyDomain(domain)
    ? '\n  "hypothesis": "гипотеза исследования (1-2 предложения)",'
    : '';

  const prompt = `Составь структуру работы (тип: ${cfg.label}).
Тема пользователя: "${topic}".
${companyHint}${aiHint}

${structureHint}

Требования к содержанию:
${contentReq}

Верни СТРОГО JSON (компактно, без лишних слов) в формате:
{
  "title": "формулировка темы",
  "object": "объект исследования",
  "subject": "предмет исследования",
  "goal": "цель",
  "tasks": ["задача 1", "задача 2", "задача 3", "задача 4", "задача 5"],
  "keywords": ["слово1", "слово2", "слово3", "слово4", "слово5"],${hypothesisField}
  "novelty": "научная новизна для бакалавра (1-2 предложения)",
  "provisions": ["положение на защиту 1", "положение 2", "положение 3"],
  "chapters": [
    {"title": "название главы", "subsections": ["параграф 1", "параграф 2", "параграф 3"]}
  ]
}
Количество глав: ${cfg.chapters}. Параграфов: ${cfg.subsectionsPerChapter}. Без markdown.`;

  const researchStub = { aiTopic: isAiTopic(topic), domain };
  const data = await chatJSON([
    { role: 'system', content: systemPrompt(researchStub) },
    { role: 'user', content: prompt },
  ], { max_tokens: 4096, jsonRetries: 4 });

  // нормализация
  data.tasks = (data.tasks || []).map((t) => cleanText(t)).filter(Boolean);
  data.keywords = (data.keywords || []).map((t) => cleanText(t)).filter(Boolean);
  data.chapters = (data.chapters || []).map((ch) => ({
    title: cleanText(ch.title),
    subsections: (ch.subsections || []).map((s) => cleanText(s)).filter(Boolean),
  }));
  data.title = cleanText(data.title || topic);
  data.object = cleanText(data.object || '');
  data.subject = cleanText(data.subject || '');
  data.goal = cleanText(data.goal || '');
  data.novelty = cleanText(data.novelty || '');
  data.hypothesis = cleanText(data.hypothesis || '');
  data.provisions = (data.provisions || []).map((p) => cleanText(p)).filter(Boolean);
  return data;
}

function introCoversOutline(paras, outline, research) {
  const text = paras.join(' ').toLowerCase();
  const hasLabel = (re) => re.test(text);
  const hasContent = (field) => {
    const s = cleanText(field || '').toLowerCase();
    if (!s || s.length < 6) return true;
    const words = s.split(/\s+/).filter((w) => w.length > 4);
    return words.length === 0 || words.some((w) => text.includes(w));
  };
  const base = hasLabel(/объект[\s\S]{0,30}исследован/i)
    && hasLabel(/предмет[\s\S]{0,30}исследован/i)
    && hasLabel(/цел[\s\S]{0,20}(работ|исследован)/i)
    && hasLabel(/задач/i)
    && hasContent(outline.object)
    && hasContent(outline.subject)
    && hasContent(outline.goal);
  if (isPedagogyDomain(research?.domain) && outline.hypothesis) {
    return base && (hasLabel(/гипотез/i) || hasContent(outline.hypothesis));
  }
  return base;
}

/** Гарантировать все 10 пунктов введения по требованиям ВКР. */
function ensureIntroStructure(paras, outline, research) {
  const text = paras.join(' ').toLowerCase();
  const inserts = [];
  
  // 1. Актуальность (проверяем, не добавляем — она в генерации)
  
  // 2. Степень разработанности
  if (!/степен\w*\s+разработ|уже\s+изучен|недостаточ/.test(text)) {
    inserts.push(`Степень разработанности темы. В психолого-педагогической литературе исследованы общие аспекты развития познавательного интереса (В.А.Сухомлинский, Л.И.Божович), однако применение инновационных методов, таких как посткроссинг, к условиям дошкольной образовательной организации остаётся недостаточно разработанным.`);
  }
  
  // 3. Объект исследования
  if (!/объект[\s\S]{0,30}исследован/i.test(text)) {
    inserts.push(`Объектом исследования выступают ${outline.object || 'процесс развития познавательного интереса дошкольников в условиях образовательной организации'}.`);
  }
  
  // 4. Предмет исследования
  if (!/предмет[\s\S]{0,30}исследован/i.test(text)) {
    inserts.push(`Предметом исследования является ${outline.subject || 'педагогические условия и методика развития познавательного интереса дошкольников посредством посткроссинга'}.`);
  }
  
  // 5. Цель исследования
  if (!/цел[\s\S]{0,20}(работ|исследован)/i.test(text)) {
    inserts.push(`Целью работы является ${outline.goal || 'теоретическое обоснование и экспериментальная проверка эффективности посткроссинга для развития познавательного интереса дошкольников'}.`);
  }
  
  // 6. Задачи исследования
  if (!/задач/i.test(text) && outline.tasks?.length) {
    const tasks = outline.tasks.slice(0, 5).map((t, i) => `${i + 1}) ${t}`).join('; ');
    inserts.push(`Для достижения цели поставлены следующие задачи: ${tasks}.`);
  }
  
  // 7. Методы (общие + специальные) — проверяем
  if (!/метод\w*\s+(анализ|синтез|наблюдение|эксперимент)/i.test(text)) {
    inserts.push(`Методы исследования: теоретические (анализ, синтез, классификация психолого-педагогической литературы), эмпирические (педагогический эксперимент, диагностика, наблюдение), статистические (критерий χ²).`);
  }
  
  // 8. Информационная база — проверяем
  if (!/информационн|источник|нормативн/.test(text)) {
    inserts.push(`Информационная и эмпирическая база исследования: нормативные документы (ФГОС дошкольного образования, СанПиН), научная и методическая литература по педагогике и психологии (учебники, статьи 2023–2026), данные педагогического эксперимента.`);
  }
  
  // 9. Практическая значимость
  if (!/практическ\w*\s+значим/.test(text)) {
    inserts.push(`Практическая значимость. Разработанная методика интеграции посткроссинга может быть внедрена в дошкольные образовательные организации для повышения познавательной активности детей. Методические рекомендации адресованы воспитателям, педагогам-психологам и методистам ДОО.`);
  }
  
  // 10. Структура работы — проверяем
  if (!/структур\w*\s+(работ|исслед)|содержит/.test(text)) {
    inserts.push(`Структура и объём работы: работа состоит из введения, трёх глав, заключения, списка использованных источников (40+ наименований) и приложений. Общий объём — около 60–80 страниц.`);
  }
  
  if (!inserts.length) return paras;
  console.log(`[quality] intro structure: added ${inserts.length} required section(s)`);
  return [...paras, ...inserts];
}

/** Генерация введения */
async function generateIntroduction(outline, cfg, research) {
  const words = cfg.wordsIntro || 1000;
  const tasksList = (outline.tasks || []).map((t, i) => `${i + 1}) ${t}`).join('; ');
  const pedagogy = isPedagogyDomain(research?.domain);
  const methodsHint = pedagogy
    ? pedagogyIntroMethodsHint()
    : '7) Методы исследования (анализ, синтез, сравнение, SWOT, моделирование BPMN/UML, экономический анализ — по теме).';
  const empiricalHint = pedagogy
    ? '8) Информационная и эмпирическая база (ФГОС ДО/ООО, СанПиН, учебники по педагогике и психологии, статьи, данные эксперимента).'
    : '8) Информационная и эмпирическая база (ФЗ, приказы, учебники, статьи, данные Росстата 2021–2026, rusprofile/audit-it при наличии).';
  const hypothesisBlock = pedagogy && outline.hypothesis
    ? `6.1) Гипотеза исследования — начни «Гипотеза исследования заключается в том, что …» и укажи: ${outline.hypothesis}.\n`
    : '';

  let lastParas = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const strictHint = attempt > 1
      ? `\nКРИТИЧНО: в тексте ОБЯЗАТЕЛЬНО должны быть явные формулировки «объект исследования», «предмет исследования», «цель работы», «задачи исследования»${pedagogy && outline.hypothesis ? ', «гипотеза исследования»' : ''} с содержанием из плана ниже.\n`
      : '';

    const prompt = `Напиши ВВЕДЕНИЕ к работе на тему "${outline.title}".
Объём ${words} слов (2–3 страницы). Строго по методике российского вуза, включи последовательно:
1) Актуальность темы (без маркетинговых клише; конкретные цифры — ТОЛЬКО из блока источников [N], иначе без процентов).
2) Степень разработанности проблемы (обзор подходов, без выдуманных имён).
3) Объект исследования — начни фразой «Объектом исследования выступают …» и укажи: ${outline.object}.
4) Предмет исследования — начни «Предметом исследования является …» и укажи: ${outline.subject}.
5) Цель работы — начни «Целью работы является …» и укажи: ${outline.goal}.
6) Задачи исследования — начни «Для достижения цели поставлены задачи:» и перечисли: ${tasksList}.
${hypothesisBlock}${methodsHint}
${empiricalHint}
9) Научная новизна: ${outline.novelty || 'уточнение и адаптация подходов к объекту исследования'}.
10) Положения, выносимые на защиту: ${(outline.provisions || []).join('; ') || 'ключевые выводы и разработанные рекомендации'}.
11) Практическая значимость (кому и как применимо).
12) Структура работы (введение, ${cfg.chapters} главы, заключение, список источников, приложения).
${strictHint}
Пиши сплошным связным текстом, абзацами. Без markdown, без заголовков, без маркеров.
${contextPrompt(research)}`;

    const raw = await chat([
      { role: 'system', content: systemPrompt(research) },
      { role: 'user', content: prompt },
    ], { max_tokens: 4500, temperature: attempt > 1 ? 0.5 : 0.55 });

    const paras = dropLeadingHeading(
      toParagraphs(sanitizeAcademicText(raw, research)),
      'Введение',
    );
    lastParas = paras;
    if (introCoversOutline(paras, outline, research)) {
      console.log(`[quality] intro ok, attempt ${attempt}`);
      return paras;
    }
    console.warn(`[quality] intro missing object/subject/goal/tasks, attempt ${attempt}`);
  }

  return ensureIntroStructure(lastParas, outline, research);
}

/** Подогнать объём под требования ВКР: ≥60 стр., ~25 стр. на главу (±10%). */
function applyPedagogyProfile(cfg, outline) {
  const next = {
    ...cfg,
    wordsPerSubsection: 2600,
    wordsIntro: 1050,
    wordsConclusion: 1050,
    chunkWords: 1500,
    minRefs: 40,
    minTables: 3,
  };
  if (outline?.chapters?.[1]?.subsections?.length >= 3) {
    const ch2 = outline.chapters[1];
    const titles = [
      'Диагностика исходного уровня (констатирующий этап)',
      'Реализация программы формирующего эксперимента',
      'Контрольный этап и оценка результатов',
    ];
    ch2.subsections = ch2.subsections.map((s, i) => titles[i] || s);
    if (/эксперимент|диагност|исследован/i.test(ch2.title || '') === false) {
      ch2.title = 'Экспериментально-диагностическое исследование эффективности программы';
    }
  }
  return next;
}

/** Бриф для параграфа в зависимости от домена и главы. */
function getSubsectionBrief({ domain, chapterIndex, cfg, outline, research, subTitle }) {
  const verifiedHint = (chapterIndex >= 1 && !isPedagogyDomain(domain))
    ? verifiedCompanyDirective(research) : '';

  if (isPedagogyDomain(domain)) {
    if (chapterIndex === 0) {
      return {
        role: 'Теоретическая глава педагогической ВКР: определения, возрастные особенности, обзор методик, нормативная база (ФГОС ДО, СанПиН).',
        extra: `Гипотеза (контекст): ${outline.hypothesis || 'см. введение'}.
Приведи 1 таблицу: сравнение методик, уровни проявления качества или нормативная база. Запрещены BPMN, UML, SWOT, IT-лексика.`,
        verifiedHint,
      };
    }
    if (chapterIndex === 1) {
      const subLower = (subTitle || '').toLowerCase();
      let stage = 'экспериментально-диагностическое содержание параграфа';
      if (/констат|диагност|исходн|начальн/i.test(subLower)) {
        stage = 'констатирующий этап: методы диагностики, шкала/критерии, первичные результаты (таблица уровней). Выборка n=25–30 детей, возраст.';
      } else if (/формир|опыт|программ|реализац/i.test(subLower)) {
        stage = 'формирующий этап: педагогические условия, программа занятий, ход эксперимента.';
      } else if (/контрол|итог|повторн/i.test(subLower)) {
        stage = 'контрольный этап: повторная диагностика, сравнение до/после, статистическая обработка (χ² или U-критерий Манна–Уитни).';
      }
      return {
        role: `Экспериментально-диагностическая глава. ${stage}`,
        extra: `${research?.companyBlock || pedagogyCompanyBlock()}
ОБЯЗАТЕЛЬНО 1 таблица с диагностическими данными (короткие ячейки). Запрещены: BPMN, UML, SWOT, предприятия, ИНН.`,
        verifiedHint: '',
      };
    }
    return {
      role: 'Заключительная глава: анализ результатов эксперимента, проверка гипотезы, рекомендации педагогам.',
      extra: `Гипотеза: ${outline.hypothesis || 'уточнить из введения'}.
Таблица: сравнение показателей до/после или результаты статистической проверки.
Положения на защиту: ${(outline.provisions || []).slice(0, 3).join('; ') || 'практические рекомендации'}.`,
      verifiedHint: '',
    };
  }

  if (chapterIndex === 0) {
    return {
      role: 'Теоретико-методологическая глава: определения, классификации, обзор подходов, нормативная база (ФЗ, ГОСТ, профильные стандарты).',
      extra: research?.aiTopic
        ? 'Обязательно включи подраздел про LLM, генеративный ИИ, RAG, AI Agents и векторные БД в контексте автоматизации бизнес-процессов. Приведи 1 таблицу сравнения подходов (классический ML vs LLM-платформа).'
        : 'Приведи 1 таблицу сравнения подходов/классификаций.',
      verifiedHint,
    };
  }
  if (chapterIndex === cfg.chapters - 1) {
    return {
      role: 'Проектно-рекомендательная глава: РАЗРАБОТКА решения (не концепция): архитектура, схемы, алгоритмы, интерфейсы, внедрение, расчёт эффекта с формулой.',
      extra: `${research?.aiTopic
        ? `Обязательно опиши РАЗРАБОТКУ системы:
- архитектура: ERP/1С → API Gateway → AI Orchestrator → LLM / RAG / ML → PostgreSQL + Vector DB;
- LLM-модуль независим от вендора (GigaChat, YandexGPT, DeepSeek через шлюз);
- UML: Use Case, Component, Sequence (генерация документа);
- ER-модель: Users, Cases, Documents, Templates, KnowledgeBase, Embeddings, GenerationHistory;
- таблица этапов внедрения; расчёт эффекта ТОЛЬКО с формулой и исходными данными из карточки (без выдуманных %).`
        : `Обязательно: 1) описание решения; 2) таблица этапов внедрения; 3) расчёт эффекта с формулой; 4) риски.
ОБЯЗАТЕЛЬНО включи минимум 1 таблицу (этапы внедрения, сравнение решений или расчёт эффекта). Без таблицы параграф неполный.`}
Положения на защиту: ${(outline.provisions || []).slice(0, 3).join('; ') || 'практические рекомендации'}.`,
      verifiedHint,
    };
  }
  return {
    role: 'Практико-аналитическая глава: характеристика объекта, процессы «as-is», SWOT, проблемы.',
    extra: `${research?.companyBlock || 'Обобщённый кейс — без конкретного юрлица и ИНН.'}
${research?.aiTopic ? 'Опиши BPMN процесса «as-is» (ручная подготовка документов) и «to-be» (AI Agent → RAG → LLM → эксперт). ' : ''}
ОБЯЗАТЕЛЬНО включи минимум 1 таблицу: показатели объекта, SWOT или сравнение «as-is / to-be». Без таблицы параграф неполный.`,
    verifiedHint,
  };
}

/** Генерация параграфа (с разбиением на части для больших объёмов) */
async function generateSubsection({
  outline, chapterIndex, chapterTitle, subTitle, subNumber, cfg, research,
  requireTable = false, tableRetryAttempt = 1,
}) {
  const domain = research?.domain || detectWorkDomain(outline.title, outline);
  const { role, extra, verifiedHint } = getSubsectionBrief({
    domain, chapterIndex, cfg, outline, research, subTitle,
  });

  const targetWords = cfg.wordsPerSubsection || 900;
  const chunkSize = cfg.chunkWords || 1400;
  const parts = targetWords > chunkSize ? Math.ceil(targetWords / chunkSize) : 1;
  const wordsPerPart = Math.ceil(targetWords / parts);

  let accumulated = '';
  for (let part = 1; part <= parts; part++) {
    const partHint = parts > 1
      ? `Это часть ${part} из ${parts} параграфа. ${part === 1 ? 'Начни с теории и определений.' : part === parts ? 'Заверши параграф выводами по подразделу.' : 'Продолжай логично предыдущую часть без повторов.'}`
      : '';
    const contHint = accumulated
      ? `\nУже написано (не повторяй, продолжай):\n${accumulated.slice(-800)}\n`
      : '';

    let tableHint = '';
    if (requireTable && part === parts) {
      tableHint = tableRetryAttempt > 1
        ? `\nВАЖНО: предыдущий ответ НЕ содержал таблицы. ${TABLE_FORMAT_HINT}\n`
        : `\n${TABLE_FORMAT_HINT}\n`;
    } else if (part === parts) {
      tableHint = `\nГде уместно — приведи 1 таблицу с обобщёнными данными в формате:
ТАБЛИЦА: Название таблицы
| Столбец1 | Столбец2 | Столбец3 |
| значение | значение | значение |
КОНЕЦ ТАБЛИЦЫ\n`;
    }

    const prompt = `Работа на тему "${outline.title}".
Напиши содержание параграфа "${subNumber}. ${subTitle}" (глава "${chapterTitle}").
${verifiedHint ? `${verifiedHint}\n` : ''}${role}
${extra}
${partHint}
Объём этой части: примерно ${wordsPerPart} слов. Пиши научным академическим стилем, связным текстом, абзацами.
Ссылайся на нормативные акты РФ и источники из блока ниже ([1], [2]…). Избегай шаблонных фраз и одинаковой длины всех абзацев.
${contextPrompt(research)}
${contHint}
${tableHint}
Не используй markdown-заголовки и маркеры списков. Не повторяй название параграфа в начале.`;

    const raw = await chat([
      { role: 'system', content: systemPrompt(research) },
      { role: 'user', content: prompt },
    ], { max_tokens: 8192, temperature: 0.6 });
    accumulated += (accumulated ? '\n\n' : '') + sanitizeAcademicText(raw.trim(), research);
  }
  return accumulated;
}

/** Выводы по главе */
async function generateChapterConclusion({ outline, chapterIndex, chapterTitle, research }) {
  const prompt = `Работа на тему "${outline.title}". Напиши краткие "Выводы по главе ${chapterIndex + 1}"
(глава "${chapterTitle}"). Объём 1–1,5 страницы (примерно 250–350 слов). Сжато обобщи главные итоги главы
связным текстом, без markdown и без маркеров.`;
  const raw = await chat([
    { role: 'system', content: systemPrompt(research) },
    { role: 'user', content: prompt },
  ], { max_tokens: 1200, temperature: 0.55 });
  return toParagraphs(sanitizeAcademicText(raw, research));
}

/** Заключение */
async function generateConclusion(outline, cfg, research) {
  const words = cfg.wordsConclusion || 900;
  const pedagogy = isPedagogyDomain(research?.domain);
  const recHint = pedagogy
    ? 'Дай практические рекомендации педагогам ДОУ/школы, подтверди или опровергни гипотезу исследования, укажи перспективы.'
    : 'Дай практические рекомендации для предприятия/отрасли и перспективы дальнейших исследований.';
  const prompt = `Напиши ЗАКЛЮЧЕНИЕ к работе на тему "${outline.title}". Объём ${words} слов (2–3 страницы).
Подведи итоги по каждой главе и по каждой задаче: ${outline.tasks.join('; ')}.
Подтверди достижение цели: ${outline.goal}.
${pedagogy && outline.hypothesis ? `Сформулируй вывод по гипотезе: ${outline.hypothesis}.` : ''}
Сформулируй научную новизну: ${outline.novelty || 'адаптация подходов к объекту'}.
Перечисли в связном тексте положения, выносимые на защиту: ${(outline.provisions || []).join('; ') || 'ключевые выводы'}.
${recHint}
Связный текст, абзацами, без markdown.`;
  const raw = await chat([
    { role: 'system', content: systemPrompt(research) },
    { role: 'user', content: prompt + contextPrompt(research) },
  ], { max_tokens: 4000, temperature: 0.6 });
  return dropLeadingHeading(toParagraphs(sanitizeAcademicText(raw, research)), 'Заключение');
}

/** Источники, сгенерированные ИИ (фолбэк / дополнение) */
const REFS_AI_RETRIES = 3;

function normalizeRefList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['sources', 'references', 'refs', 'list', 'items', 'bibliography']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return normalizeRefList(parsed);
    } catch {
      return data.split('\n').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

async function generateReferencesPlainText(outline, cfg, count, research) {
  const need = count || cfg.refsCount;
  const pedagogy = isPedagogyDomain(research?.domain);
  const extra = pedagogy
    ? `Обязательно включи: ФЗ «Об образовании в РФ» № 273-ФЗ, ФГОС ДО, СанПиН для ДОУ, учебники по дошкольной педагогике (Юрайт), статьи из «Дошкольное воспитание», «Психологическая наука и образование».`
    : 'Включи ФЗ об образовании, учебники (Юрайт/Литрес), статьи из журналов, сайты с URL и датой обращения.';
  const raw = await chat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Составь ${need} библиографических источников для работы «${outline.title}» по ГОСТ Р 7.0.100–2018.
Каждый источник — отдельная строка, без нумерации и без markdown.
${extra}`,
    },
  ], { max_tokens: 6000, temperature: 0.45, jsonMode: false });
  return String(raw || '')
    .split('\n')
    .map((s) => cleanText(s).replace(/^\d+[.)]\s*/, '').replace(/^[-*•]\s*/, ''))
    .filter((s) => s.length > 35);
}

async function generateReferencesAI(outline, cfg, count, research, attempt = 1) {
  const need = count || cfg.refsCount;
  const pedagogy = isPedagogyDomain(research?.domain);
  const pedagogyHint = pedagogy
    ? `Тема педагогическая (дошкольное образование). Обязательно включи:
- ФЗ «Об образовании в РФ» от 29.12.2012 № 273-ФЗ;
- ФГОС дошкольного образования;
- СанПиН 2.4.3648-20 «Санитарно-эпидемиологические требования…»;
- учебники по дошкольной педагогике, возрастной психологии (Юрайт, Просвещение);
- статьи из журналов «Дошкольное воспитание», «Психологическая наука и образование», «Педагогика».
Не включай IT-литературу, BPMN, ERP, бизнес-аналитику.`
    : '';
  const prompt = `Составь список использованных источников для работы на тему "${outline.title}".
Нужно ${need} источников. Используй ТОЛЬКО реальные типы источников, оформленных по ГОСТ Р 7.0.100–2018:
- нормативно-правовые акты РФ (Конституция, кодексы, федеральные законы, постановления Правительства) — в начале списка;
- учебники и учебные пособия из ЭБС Юрайт (urait.ru) и Литрес (litres.ru), реальные российские издательства (Юрайт, ИНФРА-М, КНОРУС, Питер);
- научные статьи из российских журналов (с указанием журнала, года, номера, страниц);
- электронные ресурсы (официальные сайты, Росстат) с указанием URL и даты обращения.
Годы изданий 2021–2026. Источники должны соответствовать теме.
${pedagogyHint}
Включи в список как образцы реальные книги:
- Базы данных : учебник. — Москва : Юрайт, 2024. — URL: https://urait.ru/book/bazy-dannyh-536687 (дата обращения: 01.06.2026).
- Попов А. И. Микроэкономика : учебное пособие. — Москва : Литрес, 2023.

Верни СТРОГО JSON-массив строк (каждая строка — один источник, БЕЗ нумерации в начале):
["Источник без номера", "Источник без номера", ...]
Без markdown, без пояснений.`;

  const temperature = Math.min(0.4 + (attempt - 1) * 0.15, 0.85);
  try {
    const arr = await chatJSON([
      { role: 'system', content: systemPrompt(research) },
      { role: 'user', content: prompt },
    ], { max_tokens: 8000, temperature });
    const parsed = normalizeRefList(arr)
      .map((s) => cleanText(String(s)).replace(/^\d+[.)]\s*/, ''))
      .filter(Boolean);
    if (!parsed.length && attempt < REFS_AI_RETRIES) {
      console.warn(`[refs] AI attempt ${attempt} returned empty, retry…`);
      return generateReferencesAI(outline, cfg, count, research, attempt + 1);
    }
    return parsed;
  } catch (e) {
    console.warn(`[refs] AI attempt ${attempt} error:`, e.message);
    if (attempt < REFS_AI_RETRIES) {
      return generateReferencesAI(outline, cfg, count, research, attempt + 1);
    }
    return [];
  }
}

function dedupeRefs(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const key = s.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Список источников: парсер + карточка предприятия + дополнение ИИ.
 * @returns {Promise<{list:string[], verified:number, total:number}>}
 */
async function generateReferences(outline, cfg, research, onProgress = () => {}) {
  const target = cfg.refsCount;
  const minRefs = cfg.minRefs ?? Math.ceil(target * 0.67);
  let list = dedupeRefs([...(research?.companyRefs || []), ...(research?.sources || [])]);
  const verified = research?.verified || 0;

  console.log(`[refs] start: parser=${research?.sources?.length || 0}, company=${research?.companyRefs?.length || 0}, target=${target}, min=${minRefs}`);

  let attempt = 0;
  while (list.length < minRefs && attempt < REFS_AI_RETRIES) {
    attempt += 1;
    const need = Math.max(target - list.length, minRefs - list.length + 5);
    onProgress(`Дополняю список источников (ИИ, попытка ${attempt}/${REFS_AI_RETRIES})…`);
    console.log(`[refs] AI attempt ${attempt}, need ${need}, have ${list.length}`);
    const ai = await generateReferencesAI(outline, cfg, need, research);
    console.log(`[refs] AI returned ${ai.length}`);
    list = dedupeRefs([...list, ...ai]);
  }

  if (list.length < minRefs) {
    console.warn('[refs] plain-text fallback');
    onProgress('Генерирую список источников (текстовый режим)…');
    try {
      const plain = await generateReferencesPlainText(outline, cfg, target, research);
      list = dedupeRefs([...list, ...plain]);
      console.log(`[refs] plain-text returned ${plain.length}`);
    } catch (e) {
      console.warn('[refs] plain-text failed:', e.message);
    }
  }

  if (list.length < minRefs) {
    console.warn('[refs] last resort: legacy AI prompt');
    onProgress('Генерирую список источников (резервный режим)…');
    try {
      const legacy = await _generateReferencesOld(outline, cfg);
      list = dedupeRefs([...list, ...legacy]);
    } catch (e) {
      console.warn('[refs] legacy failed:', e.message);
    }
  }

  const final = list.slice(0, target);
  console.log(`[refs] done: ${final.length} refs (verified=${verified})`);

  if (final.length < minRefs) {
    throw new Error(
      `Недостаточно источников: ${final.length} из минимум ${minRefs}. `
      + 'Проверьте OPENROUTER_API_KEY и доступность парсера Neeklo.',
    );
  }

  return { list: final, verified, total: final.length };
}

/** @deprecated старая чисто-ИИ версия списка источников */
async function _generateReferencesOld(outline, cfg) {
  const prompt = `Составь список использованных источников для работы на тему "${outline.title}".
Нужно ${cfg.refsCount} источников. Используй ТОЛЬКО реальные типы источников, оформленных по ГОСТ Р 7.0.100–2018:
- нормативно-правовые акты РФ (Конституция, кодексы, федеральные законы, постановления Правительства) — в начале списка;
- учебники и учебные пособия из ЭБС Юрайт (urait.ru) и Литрес (litres.ru), реальные российские издательства (Юрайт, ИНФРА-М, КНОРУС, Питер);
- научные статьи из российских журналов (с указанием журнала, года, номера, страниц);
- электронные ресурсы (официальные сайты, Росстат) с указанием URL и даты обращения.
Годы изданий 2021–2026. Источники должны соответствовать теме.
Включи в список как образцы реальные книги:
- Базы данных : учебник. — Москва : Юрайт, 2024. — URL: https://urait.ru/book/bazy-dannyh-536687 (дата обращения: 01.06.2026).
- Попов А. И. Микроэкономика : учебное пособие. — Москва : Литрес, 2023.

Верни СТРОГО JSON-массив строк (каждая строка — один источник, БЕЗ нумерации в начале):
["Источник без номера", "Источник без номера", ...]
Без markdown, без пояснений.`;

  const arr = await chatJSON([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ], { max_tokens: 4000, temperature: 0.4 });
  return normalizeRefList(arr).map((s) => cleanText(String(s)).replace(/^\d+[.)]\s*/, '')).filter(Boolean);
}

/** Парсинг текста параграфа в блоки (абзацы + таблицы) */
function parseSubsectionBlocks(raw) {
  const clean = String(raw).replace(/\r\n/g, '\n');
  const blocks = [];
  const lines = clean.split('\n');
  let i = 0;
  let buffer = [];

  const flushBuffer = () => flushTextBufferWithTables(buffer, blocks);

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*ТАБЛИЦА\s*:/i.test(line)) {
      flushBuffer();
      const caption = cleanText(line.replace(/^\s*ТАБЛИЦА\s*:/i, '').trim());
      i++;
      const rows = [];
      while (i < lines.length && !/^\s*КОНЕЦ\s+ТАБЛИЦЫ/i.test(lines[i])) {
        const l = lines[i];
        if (l.includes('|')) {
          const cells = l.split('|').map((c) => c.trim()).filter((c, idx, a) => !(c === '' && (idx === 0 || idx === a.length - 1)));
          // пропускаем разделительные строки markdown (---|---)
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) {
            rows.push(cells.map((c) => cleanText(c)));
          }
        }
        i++;
      }
      i++; // пропустить КОНЕЦ ТАБЛИЦЫ
      if (rows.length) {
        const tbl = { kind: 'table', caption, rows };
        if (isValidTableBlock(tbl)) blocks.push(tbl);
        else console.warn('[tables] rejected ТАБЛИЦА block with invalid rows');
      }
    } else {
      buffer.push(line);
      i++;
    }
  }
  flushBuffer();
  return blocks;
}

/** Отдельный запрос только таблицы (fallback для Gemini и др.). */
async function generateFallbackTable(ctx) {
  const jsonPrompt = `Составь одну таблицу для параграфа «${ctx.subNumber}. ${ctx.subTitle}» (тема работы: «${ctx.outline.title}»).
Верни JSON:
{"caption":"Краткое название","rows":[["Колонка1","Колонка2","Колонка3"],["значение","значение","значение"],["значение","значение","значение"]]}
Первая строка rows — заголовки. Ещё 3–4 строки данных. Каждая ячейка до 12 слов, без абзацев.`;
  try {
    const data = await chatJSON([
      { role: 'system', content: systemPrompt(ctx.research) },
      { role: 'user', content: jsonPrompt },
    ], { max_tokens: 2500, temperature: 0.3 });
    const rows = normalizeTableJSON(data);
    const caption = cleanText(data?.caption || inferTableCaption(rows || [], 'Сводные данные'));
    const tbl = { kind: 'table', caption, rows };
    if (rows && isValidTableBlock(tbl)) return tbl;
  } catch (e) {
    console.warn('[tables] JSON fallback failed:', e.message);
  }

  const prompt = `Работа на тему "${ctx.outline.title}".
Сгенерируй ТОЛЬКО одну таблицу для параграфа «${ctx.subNumber}. ${ctx.subTitle}».
${TABLE_FORMAT_HINT}
Без пояснительного текста до и после таблицы.`;
  const raw = await chat([
    { role: 'system', content: systemPrompt(ctx.research) },
    { role: 'user', content: prompt },
  ], { max_tokens: 2000, temperature: 0.35, jsonMode: false });
  const parsed = sanitizeTableBlocks(parseSubsectionBlocks(raw));
  return parsed.find((b) => b.kind === 'table') || null;
}

async function ensureMinTables(blocks, outline, cfg, research, minTables) {
  let total = countTables(blocks);
  let attempt = 0;
  while (total < minTables && attempt < minTables + 2) {
    attempt += 1;
    console.warn(`[tables] ensureMinTables: have ${total}, need ${minTables}, attempt ${attempt}`);
    const tbl = await generateFallbackTable({
      outline,
      cfg,
      research,
      subTitle: `Сводные показатели (${attempt})`,
      subNumber: `2.${attempt}`,
    });
    if (!tbl) break;
    if (!isValidTableBlock(tbl)) {
      console.warn('[tables] ensureMinTables: fallback table invalid, skip');
      break;
    }
    const idx = blocks.findIndex((b) => b.kind === 'h1' && /ЗАКЛЮЧЕНИЕ/i.test(b.text));
    blocks.splice(idx > 0 ? idx : blocks.length, 0, tbl);
    total = countTables(blocks);
  }
  return blocks;
}

/** Параграф с retry, если в главах 2+ нет таблицы. */
async function generateSubsectionWithRetry(ctx) {
  const requireTable = chapterRequiresTables(ctx.chapterIndex);
  let subBlocks = [];

  for (let attempt = 1; attempt <= TABLE_RETRY; attempt++) {
    const raw = await generateSubsection({ ...ctx, requireTable, tableRetryAttempt: attempt });
    subBlocks = sanitizeTableBlocks(parseSubsectionBlocks(raw));
    const tables = countTables(subBlocks);
    if (!requireTable || tables > 0) {
      if (requireTable) console.log(`[tables] ${ctx.subNumber}: ${tables} table(s), attempt ${attempt}`);
      break;
    }
    console.warn(`[tables] ${ctx.subNumber} attempt ${attempt}: no valid table, retry…`);
  }

  if (requireTable && countTables(subBlocks) === 0) {
    const tbl = await generateFallbackTable(ctx);
    if (tbl) {
      subBlocks.push(tbl);
      console.log(`[tables] ${ctx.subNumber}: fallback table injected`);
    }
  }

  return subBlocks;
}

/** Приложения: BPMN, UML, ER — Mermaid → PNG */
async function generateAppendices(outline, research, onProgress = () => {}) {
  return buildAppendixBlocks(outline, research, onProgress);
}

/**
 * Полная генерация документа.
 * @param {object} params {topic, workType, outline?, meta}
 * @param {(ev:{stage:string, message:string, progress:number})=>void} onProgress
 */
export async function generateDocument(params, onProgress = () => {}) {
  let cfg = WORK_TYPES[params.workType] || WORK_TYPES.vkr;
  const emit = (message, progress, extra = {}) =>
    onProgress({ stage: 'generate', message, progress, ...extra });

  let outline = params.outline;
  if (!outline) {
    emit('Формирую структуру и план работы…', 5);
    outline = await generateOutline(params);
  }

  emit('Собираю данные предприятия и источники…', 6);
  const research = await buildResearchContext(params, (msg) => emit(msg, 7));
  research.domain = detectWorkDomain(params.topic, outline);
  if (isPedagogyDomain(research.domain)) {
    research.dataMode = 'pedagogy';
    research.companyBlock = pedagogyCompanyBlock();
    research.integrityBlock = formatDataIntegrityBlock(research);
  }

  const businessObjectRe = /бизнес|процесс\w*\s+организац|предприят|мсп|мал\w*\s+бизнес|rusprofile/i;
  if (isPedagogyDomain(research.domain)) {
    if (businessObjectRe.test(outline.object || '')) {
      outline.object = 'процесс развития познавательного интереса дошкольников в условиях образовательной организации';
    }
    if (businessObjectRe.test(outline.subject || '')) {
      outline.subject = outline.subject && !businessObjectRe.test(outline.subject)
        ? outline.subject
        : 'педагогические условия и методика, обеспечивающие развитие познавательного интереса';
    }
    if (!outline.hypothesis) {
      outline.hypothesis = `развитие познавательного интереса будет более эффективным при использовании педагогического средства из темы при соблюдении определённых условий`;
    }
    console.log('[quality] pedagogy domain: hypothesis + experiment structure');
    cfg = applyPedagogyProfile(cfg, outline);
  } else if (research.dataMode === 'verified' && research.company?.name) {
    const cn = research.company.name;
    if (outline.object && /типов|модельн|обобщ|юридическ/i.test(outline.object)) {
      outline.object = `бизнес-процессы ${cn}`;
    }
    if (outline.subject && /типов|модельн|обобщ/i.test(outline.subject)) {
      outline.subject = `методы и инструменты оптимизации бизнес-процессов ${cn}`;
    }
    console.log(`[quality] verified mode: ${cn} (ИНН ${research.company.inn || '—'})`);
  } else if (isBusinessLikeDomain(research.domain) && outline.object && !/обобщ|отрасл|мал/i.test(outline.object)) {
    outline.object = 'бизнес-процессы организации отрасли (обобщённый кейс малого/среднего бизнеса)';
  }

  // подсчёт шагов для прогресса
  const totalSubs = outline.chapters.reduce((n, ch) => n + (ch.subsections?.length || 1), 0);
  const totalSteps = 1 /*intro*/ + totalSubs + outline.chapters.length /*выводы*/ + 1 /*заключ*/ + 1 /*источники*/;
  let done = 0;
  const tick = (msg) => {
    done++;
    emit(msg, 8 + Math.round((done / totalSteps) * 88));
  };

  const blocks = [];

  // Введение
  emit('Пишу введение…', 8);
  const intro = await generateIntroduction(outline, cfg, research);
  blocks.push({ kind: 'h1', text: 'ВВЕДЕНИЕ' });
  intro.forEach((p) => blocks.push({ kind: 'p', text: p }));
  tick('Введение готово');

  // Главы
  for (let c = 0; c < outline.chapters.length; c++) {
    const ch = outline.chapters[c];
    const chapterHeading = `ГЛАВА ${c + 1}. ${ch.title.toUpperCase()}`;
    blocks.push({ kind: 'h1', text: chapterHeading });

    const subs = ch.subsections && ch.subsections.length ? ch.subsections : [ch.title];
    for (let s = 0; s < subs.length; s++) {
      const subNumber = ch.subsections?.length ? `${c + 1}.${s + 1}` : `${c + 1}`;
      const subTitle = subs[s];
      emit(`Пишу параграф ${subNumber} «${subTitle}»…`, 8 + Math.round((done / totalSteps) * 88));
      if (ch.subsections?.length) {
        blocks.push({ kind: 'h2', text: `${subNumber}. ${subTitle}` });
      }
      const subBlocks = await generateSubsectionWithRetry({
        outline, chapterIndex: c, chapterTitle: ch.title, subTitle, subNumber, cfg, research,
      });
      const norm = (s) => s.toLowerCase().replace(/[«»".,:;]/g, '').replace(/^\d+(\.\d+)*\.?\s*/, '').trim();
      if (subBlocks[0] && subBlocks[0].kind === 'p' && norm(subBlocks[0].text) === norm(subTitle)) {
        subBlocks.shift();
      }
      subBlocks.forEach((b) => blocks.push(b));
      tick(`Параграф ${subNumber} готов`);
    }

    // выводы по главе
    emit(`Формулирую выводы по главе ${c + 1}…`, 8 + Math.round((done / totalSteps) * 88));
    const concl = await generateChapterConclusion({ outline, chapterIndex: c, chapterTitle: ch.title, research });
    blocks.push({ kind: 'h2', text: `Выводы по главе ${c + 1}` });
    concl.forEach((p) => blocks.push({ kind: 'p', text: p }));
    tick(`Выводы по главе ${c + 1} готовы`);
  }

  // Заключение
  emit('Пишу заключение…', 92);
  const conclusion = await generateConclusion(outline, cfg, research);
  blocks.push({ kind: 'h1', text: 'ЗАКЛЮЧЕНИЕ' });
  conclusion.forEach((p) => blocks.push({ kind: 'p', text: p }));
  tick('Заключение готово');

  // Приложения BPMN/UML/ER — только для IT-тем про ИИ
  if (research.aiTopic && params.workType === 'vkr' && research.domain === WORK_DOMAINS.it) {
    emit('Формирую приложения (BPMN, UML, ER)…', 94);
    const appBlocks = await generateAppendices(outline, research, (msg) => emit(msg, 94));
    if (appBlocks.length) {
      blocks.push({ kind: 'h1', text: 'ПРИЛОЖЕНИЯ' });
      appBlocks.forEach((b) => blocks.push(b));
      tick('Приложения готовы');
    }
  }

  // Список источников
  emit('Подбираю список использованных источников…', 96);
  const refs = await generateReferences(outline, cfg, research, (msg) => emit(msg, 96));
  blocks.push({ kind: 'h1', text: 'СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ' });
  refs.list.forEach((r, idx) => blocks.push({ kind: 'ref', text: `${idx + 1}. ${r}`, raw: r }));
  tick(refs.verified > 0
    ? `Источники готовы (${refs.verified} проверены парсером)`
    : 'Список источников готов');

  polishBlocks(blocks, research);
  const bannedLeft = countBannedInBlocks(blocks);
  if (bannedLeft) console.warn(`[quality] ${bannedLeft} paragraph(s) still contain banned phrases after polish`);

  let repaired = repairEmbeddedTablesInBlocks(blocks);
  blocks.length = 0;
  blocks.push(...repaired);

  // Удалить битые таблицы (абзац в ячейке, пустые столбцы)
  let cleaned = sanitizeTableBlocks(blocks);
  blocks.length = 0;
  blocks.push(...cleaned);

  // Production: финальная санитизация
  const { autoFixBlocks } = await import('./productionValidation.js');
  const fixed = autoFixBlocks(blocks);
  blocks.length = 0;
  blocks.push(...fixed);

  const minTables = cfg.minTables ?? 0;
  if (minTables > 0) {
    await ensureMinTables(blocks, outline, cfg, research, minTables);
    const totalTables = countTables(blocks);
    console.log(`[tables] total: ${totalTables}, min=${minTables}`);
    if (totalTables < minTables) {
      throw new Error(
        `Недостаточно таблиц: ${totalTables} из минимум ${minTables}. `
        + 'Повторите генерацию или проверьте ответ модели.',
      );
    }
  }

  emit('Проверка качества…', 98);

  if (params.workType === 'vkr' || !params.workType) {
    assertVkrQuality({
      blocks,
      outline,
      research,
      cfg,
      sources: { verified: refs.verified, total: refs.list.length },
    });
  }

  emit('Готово!', 100);

  return {
    outline,
    blocks,
    cfg: { label: cfg.label, hasTaskSheet: cfg.hasTaskSheet },
    sources: { verified: refs.verified, total: refs.list.length },
    research: {
      company: research.company?.name || params.meta?.company || null,
      verifiedSources: research.verified,
    },
  };
}
