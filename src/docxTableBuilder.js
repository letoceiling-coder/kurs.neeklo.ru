/**
 * Построение реальных DOCX таблиц из блоков.
 * Гарантирует: правильные границы, отступы, выравнивание, сквозную нумерацию.
 */
import {
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
  Paragraph, TextRun, convertMillimetersToTwip,
} from 'docx';

const FONT = 'Times New Roman';
const SIZE_MAIN = 28;   // 14pt
const SIZE_TABLE = 24;  // 12pt
const LINE_15 = 360;    // полуторный
const LINE_1 = 240;     // одинарный

/** Стандартная граница для таблиц GOST. */
function gostBorder() {
  return { style: BorderStyle.SINGLE, size: 4, color: '000000' };
}

/** Построить реальную DOCX таблицу. */
export function buildDocxTable(block) {
  if (!block.rows || block.rows.length < 2) return [];

  const rows = block.rows || [];
  const colCount = Math.max(...rows.map((r) => r.length));
  const border = gostBorder();
  const borders = { top: border, bottom: border, left: border, right: border };

  const tableRows = rows.map((cells, rIdx) => new TableRow({
    tableHeader: rIdx === 0,
    children: Array.from({ length: colCount }).map((_, cIdx) => {
      const cellText = String(cells[cIdx] || '').trim();
      const isHeader = rIdx === 0;

      return new TableCell({
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
  }));

  return [
    new Table({
      width: { size: 95, type: WidthType.PERCENTAGE },
      rows: tableRows,
    }),
  ];
}

/** Полный блок таблицы для экспорта: заголовок + таблица + отступ. */
export function buildTableBlock(tableNum, block) {
  const out = [];

  // Заголовок: "Таблица N – Название"
  out.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: LINE_1, before: 120, after: 60 },
    children: [new TextRun({
      text: `Таблица ${tableNum}${block.caption ? ' – ' + block.caption : ''}`,
      font: FONT,
      size: SIZE_MAIN,
      bold: true,
    })],
  }));

  // Сама таблица
  out.push(...buildDocxTable(block));

  // Отступ после таблицы
  out.push(new Paragraph({
    spacing: { after: 120 },
    children: [],
  }));

  return out;
}

/** Проверить таблицу на валидность DOCX. */
export function validateDocxTable(block, idx) {
  const errors = [];

  if (!block.rows || block.rows.length < 2) {
    errors.push(`таблица ${idx}: менее 2 строк (заголовок + данные)`);
    return errors;
  }

  const rows = block.rows;
  const colCount = rows[0].length;

  if (colCount < 2 || colCount > 7) {
    errors.push(`таблица ${idx}: ${colCount} столбцов (норма 2–7)`);
  }

  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].length !== colCount) {
      errors.push(`таблица ${idx}, строка ${i}: ${rows[i].length} ячеек вместо ${colCount}`);
    }

    for (let j = 0; j < rows[i].length; j += 1) {
      const cell = String(rows[i][j] || '').trim();
      if (cell.length > 200) {
        errors.push(`таблица ${idx}[${i},${j}]: ${cell.length} символов (макс 200)`);
      }
      if (i === 0 && cell.length > 80) {
        errors.push(`таблица ${idx}, заголовок[${j}]: ${cell.length} символов (макс 80)`);
      }
    }
  }

  return errors;
}

/** Есть ли в блоке markdown-таблица (опасная псевдотаблица). */
export function hasMarkdownTable(block) {
  if (block.kind === 'p') {
    return /\|[^|\n]{3,}\|[^|\n]{3,}\|/.test(block.text || '');
  }
  return false;
}

/** Найти все markdown-таблицы в тексте (опасные). */
export function findMarkdownTables(blocks) {
  return blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => hasMarkdownTable(b))
    .map(({ i }) => i);
}
