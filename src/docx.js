import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  TableOfContents, Table, TableRow, TableCell, WidthType, BorderStyle,
  Footer, PageNumber, convertMillimetersToTwip, ImageRun,
} from 'docx';
import { getWorkLabel, resolveDocumentMeta } from './templates.js';
import { numberBlocks, formatTableCaption, formatFigureCaption } from './gostNumbering.js';

const FONT = 'Times New Roman';
const SIZE_MAIN = 28;   // 14pt (half-points)
const SIZE_H1 = 32;     // 16pt
const SIZE_H2 = 28;     // 14pt
const SIZE_TABLE = 24;  // 12pt
const LINE_15 = 360;    // полуторный
const LINE_1 = 240;     // одинарный
const FIRST_LINE = convertMillimetersToTwip(15); // красная строка 1,5 см (по методичке)

function runMain(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: SIZE_MAIN, ...opts });
}

function bodyParagraph(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: LINE_15, after: 0 },
    indent: { firstLine: FIRST_LINE },
    children: [runMain(text)],
  });
}

function h1Paragraph(text, { pageBreak = true } = {}) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE_1, before: 0, after: 240 },
    pageBreakBefore: pageBreak,
    children: [new TextRun({ text: text.toUpperCase(), font: FONT, size: SIZE_H1, bold: true })],
  });
}

function h2Paragraph(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE_1, before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, size: SIZE_H2, bold: true })],
  });
}

function refParagraph(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: LINE_15, after: 60 },
    indent: { left: convertMillimetersToTwip(12.5), hanging: convertMillimetersToTwip(12.5) },
    children: [runMain(text)],
  });
}

function tableBlock(block) {
  const out = [];
  out.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: LINE_1, before: 120, after: 60 },
    children: [new TextRun({ text: formatTableCaption(block), font: FONT, size: SIZE_MAIN, bold: true })],
  }));

  const rows = block.rows || [];
  if (!rows.length) return out;
  const colCount = Math.max(...rows.map((r) => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const innerBorders = { top: border, bottom: border, left: border, right: border };

  const tableRows = rows.map((cells, rIdx) => new TableRow({
    tableHeader: rIdx === 0,
    children: Array.from({ length: colCount }).map((_, cIdx) => {
      const cellText = String(cells[cIdx] || '').trim();
      const fontSize = rIdx === 0 ? 22 : 22;
      return new TableCell({
        borders: innerBorders,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        verticalAlign: 'center',
        shading: rIdx === 0 ? { fill: 'F0F0F0' } : undefined,
        children: [new Paragraph({
          alignment: rIdx === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { line: LINE_1, after: 0 },
          children: [new TextRun({
            text: cellText,
            font: FONT,
            size: fontSize,
            bold: rIdx === 0,
          })],
        })],
      });
    }),
  }));

  out.push(new Table({
    width: { size: 95, type: WidthType.PERCENTAGE },
    rows: tableRows,
  }));
  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return out;
}

function figureBlock(block) {
  const out = [];
  const caption = formatFigureCaption(block);
  if (block.src) {
    try {
      const b64 = String(block.src).replace(/^data:image\/\w+;base64,/, '');
      const data = Buffer.from(b64, 'base64');
      if (data.length > 100) {
        out.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { line: LINE_1, before: 120, after: 60 },
          children: [new ImageRun({ data, transformation: { width: 420, height: 280 } })],
        }));
      }
    } catch (e) {
      console.warn('[docx] figure skip:', e.message);
    }
  }
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE_1, before: 0, after: 120 },
    children: [new TextRun({ text: caption, font: FONT, size: SIZE_MAIN })],
  }));
  return out;
}

/** Титульный лист */
function titlePage(meta, workLabel) {
  const center = (text, opts = {}) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE_1, after: opts.after ?? 0 },
    children: [new TextRun({ text, font: FONT, size: opts.size || SIZE_MAIN, bold: opts.bold || false, allCaps: opts.caps || false })],
  });
  const empty = (n = 1) => Array.from({ length: n }).map(() => new Paragraph({ children: [runMain('')] , spacing:{line:LINE_15}}));

  const els = [];
  els.push(center((meta.ministry || 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ').toUpperCase(), { size: 24 }));
  els.push(center((meta.university || 'НАИМЕНОВАНИЕ ОБРАЗОВАТЕЛЬНОЙ ОРГАНИЗАЦИИ').toUpperCase(), { size: 24, bold: true, after: 60 }));
  if (meta.faculty || meta.templateId === 'synergy') els.push(center(meta.faculty || '', { size: 24 }));
  if (meta.department || meta.templateId === 'synergy') {
    els.push(center('Кафедра: ' + (meta.department || ''), { size: 24, after: 120 }));
  } else if (meta.department) {
    els.push(center('Кафедра: ' + meta.department, { size: 24, after: 120 }));
  }
  els.push(...empty(4));
  els.push(center(workLabel.toUpperCase(), { size: 30, bold: true, after: 60 }));
  els.push(center('на тему:', { size: 28, after: 60 }));
  els.push(center('«' + (meta.title || '') + '»', { size: 28, bold: true, after: 120 }));
  els.push(...empty(3));

  // блок исполнитель/руководитель справа
  const rightLine = (label, value) => new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { line: LINE_15, after: 0 },
    children: [new TextRun({ text: `${label} ${value || '____________________'}`, font: FONT, size: SIZE_MAIN })],
  });
  els.push(rightLine('Выполнил(а) обучающийся:', meta.author || ''));
  if (meta.group) els.push(rightLine('Группа:', meta.group));
  els.push(rightLine('Руководитель:', meta.supervisor || ''));
  els.push(...empty(4));
  els.push(center(`${meta.city || 'Москва'} ${meta.year || new Date().getFullYear()}`, { size: SIZE_MAIN }));

  return els;
}

/** Лист задания (упрощённый) для ВКР */
function taskSheet(meta, outline) {
  const els = [];
  els.push(h1Paragraph('Задание на выполнение работы', { pageBreak: true }));
  els.push(bodyParagraph(`Тема работы: ${outline.title}.`));
  els.push(bodyParagraph(`Объект исследования: ${outline.object}.`));
  els.push(bodyParagraph(`Предмет исследования: ${outline.subject}.`));
  els.push(bodyParagraph(`Цель работы: ${outline.goal}.`));
  els.push(bodyParagraph('Перечень подлежащих разработке вопросов (задачи исследования):'));
  (outline.tasks || []).forEach((t, i) => els.push(bodyParagraph(`${i + 1}. ${t}`)));
  els.push(bodyParagraph('Перечень структурных элементов: введение, основная часть (главы), заключение, список использованных источников, приложения.'));
  return els;
}

/** Содержание (автособираемое поле Word) */
function tableOfContents() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: LINE_1, after: 240 },
      pageBreakBefore: true,
      children: [new TextRun({ text: 'СОДЕРЖАНИЕ', font: FONT, size: SIZE_H1, bold: true })],
    }),
    new TableOfContents('Содержание', {
      hyperlink: true,
      headingStyleRange: '1-2',
      stylesWithLevels: [],
    }),
  ];
}

function blocksToElements(blocks) {
  const els = [];
  for (const b of numberBlocks(blocks)) {
    switch (b.kind) {
      case 'h1':
        els.push(h1Paragraph(b.text));
        break;
      case 'h2':
        els.push(h2Paragraph(b.text));
        break;
      case 'p':
        els.push(bodyParagraph(b.text));
        break;
      case 'ref':
        els.push(refParagraph(b.text));
        break;
      case 'table':
        tableBlock(b).forEach((e) => els.push(e));
        break;
      case 'figure':
        figureBlock(b).forEach((e) => els.push(e));
        break;
      default:
        if (b.text) els.push(bodyParagraph(b.text));
    }
  }
  return els;
}

/**
 * Генерация .docx как Buffer.
 * @param {object} doc { outline, blocks, cfg, meta }
 */
export async function buildDocx(doc) {
  const outline = doc.outline || {};
  const meta = resolveDocumentMeta(doc.meta || {}, {
    workType: doc.workType,
    outline,
    cfg: doc.cfg,
    topic: doc.meta?.title,
  });
  const workLabel = getWorkLabel(meta, doc.cfg, doc.workType);

  const children = [];
  // Титульный лист
  children.push(...titlePage({ ...meta, title: meta.title || outline.title }, workLabel));
  // Задание (для ВКР)
  if (doc.cfg && doc.cfg.hasTaskSheet) {
    children.push(...taskSheet(meta, outline));
  }
  // Содержание
  children.push(...tableOfContents());
  // Основной текст
  children.push(...blocksToElements(doc.blocks || []));

  const document = new Document({
    creator: 'Diplomat AI',
    title: meta.title || outline.title || 'Работа',
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE_MAIN } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: SIZE_H1, bold: true },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { line: LINE_1, after: 240 } },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: SIZE_H2, bold: true },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { line: LINE_1, before: 240, after: 120 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(10),
              bottom: convertMillimetersToTwip(20),
              left: convertMillimetersToTwip(30),
            },
          },
          titlePage: true,
        },
        headers: {},
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE_MAIN })],
            })],
          }),
          first: new Footer({ children: [new Paragraph({ children: [] })] }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
