/**
 * Production-качество: санитизация текста, валидация структуры, соответствие ГОСТ.
 */

const EXTRA_SYMBOLS_RE = /КОНЕЦ\s+ТАБЛИЦЫ|[,]{2,}|[.]{2,}|[;]{2,}|[\u00AD\u200B\u200C\u200D]/g;
const MULTIPLE_SPACES_RE = /\s{2,}/g;
const MULTIPLE_NEWLINES_RE = /\n{3,}/g;

/** Очистить текст абзаца от служебных символов, двойных запятых и прочего. */
export function sanitizeTextBlock(text) {
  if (!text) return '';
  let t = String(text)
    .replace(EXTRA_SYMBOLS_RE, '')
    .replace(MULTIPLE_SPACES_RE, ' ')
    .trim();
  if (t.endsWith(',')) t = t.slice(0, -1).trim();
  if (t.endsWith(';')) t = t.slice(0, -1).trim();
  return t;
}

/** Санитизировать все абзацы в блоках. */
export function sanitizeAllBlocks(blocks) {
  return blocks.map((b) => {
    if (b.kind === 'p' && b.text) {
      return { ...b, text: sanitizeTextBlock(b.text) };
    }
    if (b.kind === 'h1' || b.kind === 'h2') {
      return { ...b, text: sanitizeTextBlock(b.text || '') };
    }
    if (b.kind === 'table' && b.rows) {
      return {
        ...b,
        rows: b.rows.map((row) =>
          row.map((cell) => sanitizeTextBlock(String(cell || ''))),
        ),
      };
    }
    return b;
  }).filter((b) => {
    if (b.kind === 'p') return b.text && b.text.length > 3;
    if (b.kind === 'h1' || b.kind === 'h2') return b.text && b.text.length > 2;
    if (b.kind === 'table') return (b.rows || []).length >= 2;
    return true;
  });
}

/** Проверить таблицу на соответствие ГОСТ. */
export function validateTable(block, index) {
  const errors = [];
  if (!block.rows || block.rows.length < 2) {
    errors.push('таблица < 2 строк');
    return errors;
  }
  const colCount = block.rows[0].length;
  if (colCount < 2 || colCount > 7) errors.push(`столбцов: ${colCount}, норма 2–7`);
  for (let i = 0; i < block.rows.length; i += 1) {
    if (block.rows[i].length !== colCount) {
      errors.push(`строка ${i}: ${block.rows[i].length} ячеек вместо ${colCount}`);
    }
    for (let j = 0; j < block.rows[i].length; j += 1) {
      const cell = String(block.rows[i][j] || '');
      if (cell.length > 200) errors.push(`ячейка [${i},${j}]: ${cell.length} символов (макс 200)`);
      if (i === 0 && cell.length > 80) errors.push(`заголовок [${j}]: ${cell.length} символов (макс 80)`);
    }
  }
  return errors;
}

/** Проверить структуру введения. */
export function validateIntro(blocks) {
  const intro = [];
  let capture = false;
  for (const b of blocks) {
    if (b.kind === 'h1' && /ВВЕДЕНИЕ/i.test(b.text || '')) {
      capture = true;
      continue;
    }
    if (capture && b.kind === 'h1' && !/ВВЕДЕНИЕ/i.test(b.text || '')) break;
    if (capture) intro.push(b);
  }

  const introText = intro.map((b) => b.text || '').join(' ').toLowerCase();
  const checks = {
    actuality: /актуальн/.test(introText),
    degree: /степен\w*\s+разработ|уже\s+изучен|недостаточ/.test(introText),
    object: /объект[\s\S]{0,40}исследова/.test(introText),
    subject: /предмет[\s\S]{0,40}исследова/.test(introText),
    goal: /цел[\s\S]{0,30}(работ|исследова)/.test(introText),
    tasks: /задач/.test(introText),
    methods: /метод/.test(introText),
    base: /информационн|норматив|источник/.test(introText),
    practical: /практическ\w*\s+значим/.test(introText),
    structure: /структур/.test(introText) && /глав/.test(introText),
  };

  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return { checks, missing, totalBlocks: intro.length };
}

/** Проверить баланс глав. */
export function validateChapterBalance(blocks) {
  const chapters = [];
  let current = null;
  for (const b of blocks) {
    if (b.kind === 'h1' && /^ГЛАВА\s+\d+/i.test(b.text || '')) {
      if (current) chapters.push(current);
      current = { title: b.text, words: 0 };
    } else if (current && (b.kind === 'p' || b.kind === 'h2')) {
      current.words += (b.text || '').split(/\s+/).filter(Boolean).length;
    }
  }
  if (current) chapters.push(current);

  const pages = chapters.map((c) => Math.round(c.words / 300));
  const avgPages = pages.length ? pages.reduce((a, b) => a + b, 0) / pages.length : 0;
  const target = 25;
  const maxDev = 15;

  const balance = chapters.map((c, i) => {
    const p = pages[i];
    const dev = avgPages ? Math.abs(p - avgPages) / avgPages * 100 : 0;
    return {
      chapter: c.title,
      pages: p,
      devPercent: Math.round(dev),
      ok: dev <= maxDev,
    };
  });

  const allOk = balance.every((b) => b.ok);
  return { balance, allOk, avgPages: Math.round(avgPages), target };
}

/** Полная валидация структуры ВКР. */
export function validateVkrStructure(blocks) {
  const h1 = blocks.filter((b) => b.kind === 'h1').map((b) => b.text || '');
  const required = {
    title: false,
    contents: false,
    intro: false,
    ch1: false,
    ch2: false,
    ch3: false,
    conclusion: false,
    refs: false,
  };

  for (const t of h1) {
    if (/ВВЕДЕНИЕ/i.test(t)) required.intro = true;
    if (/СОДЕРЖАНИЕ|ОГЛАВЛЕНИЕ/i.test(t)) required.contents = true;
    if (/^ГЛАВА\s+1/i.test(t)) required.ch1 = true;
    if (/^ГЛАВА\s+2/i.test(t)) required.ch2 = true;
    if (/^ГЛАВА\s+3/i.test(t)) required.ch3 = true;
    if (/ЗАКЛЮЧЕНИЕ/i.test(t)) required.conclusion = true;
    if (/СПИСОК\s+ИСПОЛЬЗУЕМЫХ|СПИСОК\s+ЛИТЕРАТУР/i.test(t)) required.refs = true;
  }

  const missing = Object.entries(required)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const totalWords = blocks
    .filter((b) => b.kind === 'p' || b.kind === 'h1' || b.kind === 'h2')
    .map((b) => b.text || '')
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

  const pages = Math.round(totalWords / 300);
  const refs = blocks.filter((b) => b.kind === 'ref').length;
  const tables = blocks.filter((b) => b.kind === 'table').length;

  return {
    required,
    missing,
    stats: { words: totalWords, pages, refs, tables },
    ok: missing.length === 0 && pages >= 60 && pages <= 85 && refs >= 40 && tables >= 3,
  };
}

/** Исправить типичные ошибки. */
export function autoFixBlocks(blocks) {
  let fixed = sanitizeAllBlocks(blocks);

  fixed = fixed.filter((b) => {
    if (b.kind === 'table') {
      const errs = validateTable(b);
      if (errs.length) {
        console.warn('[validation] skipping bad table:', errs.join('; '));
        return false;
      }
    }
    return true;
  });

  return fixed;
}
