/** Проверка ИНН (10 или 12 цифр). */
export function isValidInn(inn) {
  const s = String(inn || '').replace(/\D/g, '');
  return s.length === 10 || s.length === 12;
}

/** Режим данных: verified — карточка с ИНН; generic — без конкретного юрлица. */
export function getDataMode(company) {
  if (company?.inn && isValidInn(company.inn)) return 'verified';
  return 'generic';
}

/** Маркетинговые клише — не использовать в академическом тексте. */
export const BANNED_PHRASES = [
  'стремительная цифровая трансформация',
  'ключевой драйвер развития',
  'ключевой драйвер',
  'насущная необходимость',
  'существенно повысить эффективность',
  'революционизировать',
  'уникальное конкурентное преимущество',
  'на передовой технологий',
  'беспрецедентный рост',
  'играющий ключевую роль',
  'в условиях стремительного развития',
  'является важнейшим фактором',
  'открывает новые горизонты',
  'на современном этапе развития общества',
  'приобретает особую актуальность',
  'нельзя недооценивать',
  'в современном мире',
];

/** Regex-замены AI-клише → нейтральные формулировки. */
export const BANNED_REPLACEMENTS = [
  [/стремительн\w*\s+цифров\w*\s+трансформаци\w*/gi, 'цифровизация отраслей экономики'],
  [/ключев\w*\s+драйвер\w*(\s+развития)?/gi, 'фактор развития'],
  [/насущн\w*\s+необходимост\w*/gi, 'практическая значимость'],
  [/существенно\s+повыс\w*\s+эффективност\w*/gi, 'повышение эффективности'],
  [/революциониз\w*/gi, 'трансформ'],
  [/уникальн\w*\s+конкурентн\w*\s+преимуществ\w*/gi, 'конкурентное преимущество'],
  [/на\s+передов\w*\s+технолог\w*/gi, 'в области современных технологий'],
  [/беспрецедентн\w*\s+рост\w*/gi, 'устойчивый рост'],
  [/игра\w*\s+ключев\w*\s+рол\w*/gi, 'имеет значение'],
  [/в\s+условиях\s+стремительн\w*\s+развит\w*/gi, 'в текущих экономических условиях'],
  [/явля\w*\s+важнейш\w*\s+фактор\w*/gi, 'является значимым фактором'],
  [/открывает\s+новые\s+горизонт\w*/gi, 'расширяет возможности'],
  [/на\s+современном\s+этапе\s+развития\s+общества/gi, 'в настоящее время'],
  [/приобрет\w*\s+особ\w*\s+актуальност\w*/gi, 'имеет прикладное значение'],
  [/нельзя\s+недооценивать/gi, 'следует учитывать'],
  [/в\s+современном\s+мире/gi, 'в настоящее время'],
];

/** Блок правил для промптов — только реальные данные. */
export function formatDataIntegrityBlock(research) {
  const mode = research?.dataMode || getDataMode(research?.company);
  const lines = [
    '--- ПРАВИЛА ДОСТОВЕРНОСТИ ДАННЫХ (ОБЯЗАТЕЛЬНО) ---',
    'Запрещено выдумывать: ИНН, ОГРН, КПП, выручку, численность, названия юрлиц, проценты эффективности без расчёта и источника.',
    'Запрещены маркетинговые клише: «стремительная цифровая трансформация», «ключевой драйвер», «насущная необходимость» и аналоги.',
    'Любая цифра (%, минуты, руб.) — только из эмпирической базы или списка источников [N]; иначе не указывай число.',
  ];

  if (mode === 'pedagogy') {
    lines.push(
      'Режим: ПЕДАГОГИЧЕСКОЕ ИССЛЕДОВАНИЕ.',
      'Эмпирическая база: ДОУ/школа (обобщённый кейс), выборка 25–30 детей, ФГОС ДО, СанПиН.',
      'Запрещено: BPMN, UML, SWOT, предприятия, ИНН, rusprofile, бизнес-процессы.',
      'Диагностические данные в таблицах — обобщённые уровни (низкий/средний/высокий), без вымышленных названий учреждений.',
    );
    return lines.join('\n');
  }

  if (mode === 'verified') {
    lines.push(
      'Режим: ВЕРИФИЦИРОВАННОЕ предприятие. Используй ТОЛЬКО реквизиты из карточки ниже.',
      'Запрещено подменять организацию другим названием или ИНН.',
      'В практической главе обязательно укажи полное наименование предприятия и его показатели из карточки.',
    );
  } else {
    lines.push(
      'Режим: ОБОБЩЁННЫЙ КЕЙС. Карточка предприятия с rusprofile/audit-it не загружена.',
      'Пиши: «на примере организации отрасли (малый/средний бизнес)» — БЕЗ конкретного названия, БЕЗ ИНН, БЕЗ ОГРН.',
      'Нельзя писать «ООО …» с вымышленным ИНН — комиссия проверит реестр.',
    );
  }

  if (research?.aiTopic) {
    lines.push(
      'Тема про ИИ: это РАЗРАБОТКА системы — опиши BPMN (as-is/to-be), UML (Use Case, Component, Sequence), ER-модель БД (Users, Documents, Templates, KnowledgeBase, Embeddings, GenerationHistory).',
      'LLM-модуль технологически независим: укажи, что допустимы GigaChat, YandexGPT, DeepSeek через единый API Gateway.',
      'Таблицу KPI «до/после» заполняй только с пояснением методики расчёта; без выдуманных «−40%» и «−70%».',
    );
  }

  return lines.join('\n');
}

/** Директива для промптов практических глав (verified). */
export function verifiedCompanyDirective(research) {
  if (research?.dataMode !== 'verified' || !research.company?.name) return '';
  const c = research.company;
  return `ВЕРИФИЦИРОВАННЫЙ ОБЪЕКТ: ${c.name}${c.inn ? ` (ИНН ${c.inn})` : ''}.
Анализируй ТОЛЬКО это предприятие. Показатели (выручка, численность, ОКВЭД) — только из карточки ниже.
Запрещено подменять организацию или придумывать реквизиты.`;
}

export function filterBannedPhrases(text) {
  let t = String(text || '');
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    t = t.replace(re, '');
  }
  for (const [re, repl] of BANNED_REPLACEMENTS) {
    t = t.replace(re, repl);
  }
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
}

/** Проценты без ссылки [N] или расчёта — убрать из предложения. */
export function sanitizeBareStats(text, research) {
  if (!text || !/\d{1,3}\s*%/.test(text)) return text;
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const out = sentences.map((sent) => {
    if (!/\d{1,3}\s*%/.test(sent)) return sent;
    if (/\[\d+\]/.test(sent)) return sent;
    if (/формул|расчёт|расчет|исходн\w*\s+данн/i.test(sent)) return sent;
    return sent.replace(/\s*[-–—]?\s*\d{1,3}\s*%/g, '').replace(/\d{1,3}\s*%\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  });
  return out.filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Удаляет вымышленные ИНН/ОГРН из текста в generic-режиме.
 */
export function sanitizeFictionalRequisites(text, research) {
  if (!text || getDataMode(research?.company) === 'verified') return text;
  let t = String(text);
  t = t.replace(/\bИНН\s*[:№]?\s*\d{10,12}\b/gi, '');
  t = t.replace(/\bОГРН\s*[:№]?\s*\d{13,15}\b/gi, '');
  t = t.replace(/\bКПП\s*[:№]?\s*\d{9}\b/gi, '');
  t = t.replace(/ООО\s+[«"][^»"]{3,80}[»"]\s*,?\s*ИНН\s*\d+/gi, 'организации отрасли (обобщённый кейс)');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

/** IT/бизнес-лексика, недопустимая в педагогических ВКР. */
const PEDAGOGY_IT_REPLACEMENTS = [
  [/\bBPMN\b/gi, 'схема педагогического процесса'],
  [/\bUML\b/gi, 'схема'],
  [/\bSWOT[\s-]?анализ\w*/gi, 'анализ сильных и слабых сторон'],
  [/\bSWOT\b/gi, 'анализ'],
  [/\bERP[\s-]?систем\w*/gi, 'информационная система ДОУ'],
  [/\bAPI[\s-]?Gateway\b/gi, 'информационный ресурс'],
  [/\bбизнес[\s-]?процесс\w*/gi, 'педагогический процесс'],
  [/\bмал\w*\s+и\s+средн\w*\s+предпринимательств\w*/gi, 'дошкольное образование'],
  [/\brusprofile\b/gi, ''],
  [/\baudit-it\b/gi, ''],
  [/познават\w*\s+interest\b/gi, 'познавательный интерес'],
  [/\binterest\b/gi, 'интерес'],
  [/\bархитектур\w*\s+(систем|модел|решени)\w*/gi, 'структура программы'],
];

export function filterPedagogyItLeaks(text, research) {
  if (research?.domain !== 'pedagogy') return text;
  let t = String(text || '');
  for (const [re, repl] of PEDAGOGY_IT_REPLACEMENTS) {
    t = t.replace(re, repl);
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

/** Полная санитизация текста перед парсингом в блоки. */
export function sanitizeAcademicText(text, research) {
  let t = sanitizeFictionalRequisites(text, research);
  t = filterBannedPhrases(t);
  t = sanitizeBareStats(t, research);
  t = filterPedagogyItLeaks(t, research);
  return t;
}

export function containsBannedPhrase(text) {
  const lower = String(text || '').toLowerCase();
  if (BANNED_PHRASES.some((p) => lower.includes(p.toLowerCase()))) return true;
  return BANNED_REPLACEMENTS.some(([re]) => re.test(text));
}

/** Финальная зачистка абзацев перед сохранением документа. */
export function polishBlocks(blocks, research = null) {
  let fixes = 0;
  for (const b of blocks) {
    if (b.kind !== 'p') continue;
    const before = b.text;
    b.text = filterPedagogyItLeaks(filterBannedPhrases(sanitizeBareStats(b.text, null)), research);
    if (b.text !== before) fixes += 1;
  }
  if (fixes) console.log(`[quality] polished ${fixes} paragraph(s)`);
  return blocks;
}

export function countBannedInBlocks(blocks) {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === 'p' && containsBannedPhrase(b.text)) n += 1;
  }
  return n;
}
