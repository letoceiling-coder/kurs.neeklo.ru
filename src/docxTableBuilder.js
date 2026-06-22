/**
 * Построение реальных DOCX таблиц с ФИКСИРОВАННОЙ шириной колонок.
 * Гарантирует: таблица не выходит за поля, нет схлопывания колонок в «буквы»,
 * единый стиль, корректные границы и отступы по ГОСТ.
 */
import {
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
  Paragraph, TextRun, TableLayoutType, convertMillimetersToTwip,
} from 'docx';

const FONT = 'Times New Roman';
const SIZE_MAIN = 28;   // 14pt
const SIZE_TABLE = 24;  // 12pt
const LINE_1 = 240;     // одинарный

// A4 = 210 мм; поля левое 30 + правое 10 = 40 мм; печатное поле = 170 мм.
const USABLE_WIDTH_MM = 170;
const USABLE_WIDTH_DXA = convertMillimetersToTwip(USABLE_WIDTH_MM); // ≈ 9639 twips
const MIN_COL_MM = 18; // минимальная ширина колонки, чтобы не было «букв в столбик»

function gostBorder() {
  return { style: BorderStyle.SINGLE, size: 4, color: '000000' };
}

/**
 * Рассчитать ширины колонок (в DXA) пропорционально содержимому,
 * но не уже MIN_COL_MM и так, чтобы сумма == печатному полю.
 */
export function computeColumnWidths(rows, colCount) {
  // Максимальная длина содержимого в каждом столбце
  const maxLen = Array.from({ length: colCount }, (_, c) => {
    let m = 1;
    for (const row of rows) {
      const cell = String(row[c] || '').trim();
      if (cell.length > m) m = cell.length;
    }
    return m;
  });

  const minDxa = convertMillimetersToTwip(MIN_COL_MM);
  const totalMin = minDxa * colCount;

  // Если минимумов уже больше печатного поля — делим поровну
  if (totalMin >= USABLE_WIDTH_DXA) {
    const equal = Math.floor(USABLE_WIDTH_DXA / colCount);
    return Array.from({ length: colCount }, () => equal);
  }

  // Распределяем «свободную» ширину пропорционально длине содержимого
  const totalLen = maxLen.reduce((a, b) => a + b, 0) || 1;
  const free = USABLE_WIDTH_DXA - totalMin;
  let widths = maxLen.map((len) => minDxa + Math.round((len / totalLen) * free));

  // Корректируем сумму до точного значения печатного поля
  const sum = widths.reduce((a, b) => a + b, 0);
  const diff = USABLE_WIDTH_DXA - sum;
  widths[widths.length - 1] += diff;

  return widths;
}

/** Разбить слишком длинное «слово» (URL, код), чтобы не было переноса по 1 букве. */
function softenLongTokens(text) {
  return String(text || '')
    .split(/(\s+)/)
    .map((tok) => {
      if (/\s+/.test(tok) || tok.length <= 25) return tok;
      // Вставляем мягкие переносы в длинный токен
      return tok.replace(/(.{20})/g, '$1\u200B');
    })
    .join('');
}

/** Построить реальную DOCX таблицу с фиксированными колонками. */
export function buildDocxTable(block) {
  if (!block.rows || block.rows.length < 2) return [];

  const rows = block.rows;
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths = computeColumnWidths(rows, colCount);
  const border = gostBorder();
  const borders = { top: border, bottom: border, left: border, right: border };

  const tableRows = rows.map((cells, rIdx) => {
    const isHeader = rIdx === 0;
    return new TableRow({
      tableHeader: isHeader,
      cantSplit: true, // строка не разрывается между страницами
      children: Array.from({ length: colCount }).map((_, cIdx) => {
        const cellText = softenLongTokens(String(cells[cIdx] || '').trim());
        return new TableCell({
          width: { size: colWidths[cIdx], type: WidthType.DXA },
          borders,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          verticalAlign: 'center',
          shading: isHeader ? { fill: 'F0F0F0' } : undefined,
          children: [new Paragraph({
            alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { line: LINE_1, after: 0 },
            children: [new TextRun({
              text: cellText,
              font: FONT,
              size: SIZE_TABLE,
              bold: isHeader,
            })],
          })],
        });
      }),
    });
  });

  return [
    new Table({
      layout: TableLayoutType.FIXED, // КРИТИЧНО: фикс. раскладка, без autofit
      width: { size: USABLE_WIDTH_DXA, type: WidthType.DXA },
      columnWidths: colWidths,
      rows: tableRows,
    }),
  ];
}

/** Полный блок таблицы: заголовок ("Таблица N – Название") + таблица + отступ + анализ. */
export function buildTableBlock(tableNum, block) {
  const out = [];

  out.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: LINE_1, before: 120, after: 60 },
    keepNext: true, // заголовок не отрывается от таблицы
    children: [new TextRun({
      text: `Таблица ${tableNum}${block.caption ? ' – ' + block.caption : ''}`,
      font: FONT,
      size: SIZE_MAIN,
      bold: true,
    })],
  }));

  out.push(...buildDocxTable(block));

  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));

  return out;
}

/** Проверить таблицу на валидность DOCX (нормоконтроль). */
export function validateDocxTable(block, idx) {
  const errors = [];

  if (!block.rows || block.rows.length < 2) {
    errors.push(`таблица ${idx}: менее 2 строк (заголовок + данные)`);
    return errors;
  }

  const rows = block.rows;
  const colCount = rows[0].length;

  if (colCount < 2 || colCount > 6) {
    errors.push(`таблица ${idx}: ${colCount} столбцов (норма 2–6, иначе не помещается)`);
  }

  // Проверка ширины колонок: не уже минимума
  const colWidths = computeColumnWidths(rows, colCount);
  const minDxa = convertMillimetersToTwip(MIN_COL_MM);
  colWidths.forEach((w, c) => {
    if (w < minDxa - 50) {
      errors.push(`таблица ${idx}, колонка ${c}: ширина ${Math.round(w / 56.7)}мм < ${MIN_COL_MM}мм (риск переноса по буквам)`);
    }
  });

  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].length !== colCount) {
      errors.push(`таблица ${idx}, строка ${i}: ${rows[i].length} ячеек вместо ${colCount}`);
    }
    for (let j = 0; j < rows[i].length; j += 1) {
      const cell = String(rows[i][j] || '').trim();
      if (cell.length > 180) {
        errors.push(`таблица ${idx}[${i},${j}]: ${cell.length} символов (макс 180, иначе переполнение)`);
      }
      if (i === 0 && cell.length > 60) {
        errors.push(`таблица ${idx}, заголовок[${j}]: ${cell.length} символов (макс 60)`);
      }
    }
  }

  // Нет полностью пустых строк
  const emptyRows = rows.filter((r) => r.every((c) => !String(c || '').trim())).length;
  if (emptyRows) errors.push(`таблица ${idx}: ${emptyRows} пустых строк`);

  return errors;
}

/** Есть ли в абзаце markdown-таблица или пайп-псевдотаблица (X | Y | Z). */
export function hasMarkdownTable(block) {
  if (block.kind !== 'p') return false;
  const t = block.text || '';
  // Классическая markdown-таблица: | a | b | c |
  if (/\|[^|\n]{2,}\|[^|\n]{2,}\|/.test(t)) return true;
  // Пайп-псевдотаблица в строке: «Автор | Компоненты | Возраст» (≥2 разделителей)
  if ((t.match(/\s\|\s/g) || []).length >= 2) return true;
  return false;
}

/** Найти все markdown-таблицы в тексте. */
export function findMarkdownTables(blocks) {
  return blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => hasMarkdownTable(b))
    .map(({ i }) => i);
}
