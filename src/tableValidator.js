/**
 * Валидация таблиц и аналитики перед финальным экспортом в DOCX.
 */
import {
  findMarkdownTables, validateDocxTable, hasMarkdownTable,
} from './docxTableBuilder.js';

const PSEUDOTABLE_PATTERNS = [
  /^\s*[^\n|]*;\s*[^\n|]*;\s*[^\n|]*;\s*[^\n|]*\s*$/m,
  /^\s*[^\n|]*→\s*[^\n|]*→\s*[^\n|]*\s*$/m,
  /^\s*[^\n|]*–\s*[^\n|]*–\s*[^\n|]*\s*$/m,
];

/**
 * Критическая валидация перед DOCX экспортом.
 * Возвращает { ok: true/false, errors: [] }
 */
export function validateDocxStructure(blocks, outline) {
  const errors = [];
  const warnings = [];

  // 1. Markdown-таблицы (КРИТИЧНО)
  const markdownIdx = findMarkdownTables(blocks);
  if (markdownIdx.length) {
    markdownIdx.forEach((i) => {
      errors.push(`Блок ${i}: markdown-таблица |...|... (запрещено, нужна настоящая таблица DOCX)`);
    });
  }

  // 2. Псевдотаблицы через ; или → (КРИТИЧНО)
  blocks.forEach((b, i) => {
    if (b.kind === 'p') {
      for (const pat of PSEUDOTABLE_PATTERNS) {
        if (pat.test(b.text || '')) {
          errors.push(`Блок ${i}: псевдотаблица через разделители (запрещено)`);
          break;
        }
      }
    }
  });

  // 3. Все DOCX таблицы валидны
  blocks.forEach((b, i) => {
    if (b.kind === 'table') {
      const tableErrs = validateDocxTable(b, i);
      tableErrs.forEach((e) => errors.push(e));
    }
  });

  // 4. Таблицы имеют подписи и номера
  let tableNum = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b.kind === 'table') {
      tableNum += 1;
      if (!b.caption || b.caption.length < 3) {
        warnings.push(`Таблица ${tableNum}: отсутствует или короткое название`);
      }
    }
  }

  // 5. После каждой таблицы есть анализ (КРИТИЧНО)
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].kind === 'table') {
      let hasAnalysis = false;
      for (let j = i + 1; j < Math.min(i + 4, blocks.length); j += 1) {
        if (blocks[j].kind === 'p' && blocks[j].text && blocks[j].text.length > 50) {
          hasAnalysis = true;
          break;
        }
      }
      if (!hasAnalysis) {
        errors.push(`После таблицы ${i}: отсутствует анализ (запрещено)`);
      }
    }
  }

  // 6. Визуальный баланс: не более 3 страниц без таблиц/рисунков
  let pagesWithoutVisuals = 0;
  let currentPages = 0;
  blocks.forEach((b) => {
    if (b.kind === 'h1') currentPages = 0;
    if (b.kind === 'p') currentPages += (b.text || '').split(/\s+/).length / 300;
    if (b.kind === 'table' || b.kind === 'figure') currentPages = 0;
    if (currentPages > 3) {
      pagesWithoutVisuals += 1;
      currentPages = 0;
    }
  });
  if (pagesWithoutVisuals > 1) {
    warnings.push(`${pagesWithoutVisuals} секций без таблиц/рисунков (рекомендуется добавить визуальные элементы)`);
  }

  // 7. Структура: титул, содержание, введение, главы, заключение, литература
  const h1 = blocks.filter((b) => b.kind === 'h1').map((b) => b.text || '');
  const hasIntro = h1.some((t) => /ВВЕДЕНИЕ/i.test(t));
  const hasChs = h1.filter((t) => /^ГЛАВА\s+\d+/i.test(t)).length >= 3;
  const hasConc = h1.some((t) => /ЗАКЛЮЧЕНИЕ/i.test(t));
  const hasRefs = h1.some((t) => /СПИСОК.*ИСТОЧНИК/i.test(t));

  if (!hasIntro) errors.push('Отсутствует ВВЕДЕНИЕ');
  if (!hasChs || h1.filter((t) => /^ГЛАВА\s+\d+/i.test(t)).length < 3) {
    errors.push(`Ожидается 3 главы, найдено ${h1.filter((t) => /^ГЛАВА\s+\d+/i.test(t)).length}`);
  }
  if (!hasConc) errors.push('Отсутствует ЗАКЛЮЧЕНИЕ');
  if (!hasRefs) errors.push('Отсутствует СПИСОК ИСТОЧНИКОВ');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/** Auto-fix попытка: убрать markdown-таблицы из текста (конвертировать в анализ). */
export function autoFixTables(blocks) {
  return blocks
    .filter((b) => {
      if (b.kind === 'p' && hasMarkdownTable(b)) {
        console.warn('[validator] removed markdown table from text block');
        return false;
      }
      return true;
    });
}
