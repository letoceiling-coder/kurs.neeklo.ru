import { blocksToHtml } from './blocksToHtml.js';
import { resolveDocumentMeta } from './templates.js';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Построить строки содержания из блоков */
export function buildTocLines(blocks) {
  const lines = [];
  for (const b of blocks || []) {
    if (b.kind === 'h1') lines.push({ level: 1, text: b.text });
    if (b.kind === 'h2') lines.push({ level: 2, text: b.text });
  }
  return lines;
}

function tocHtml(lines) {
  if (!lines.length) return '<p class="toc-empty">Содержание формируется по заголовкам работы.</p>';
  return lines.map((l) => {
    const cls = l.level === 1 ? 'toc-h1' : 'toc-h2';
    const pad = l.level === 2 ? 'padding-left:14mm;' : '';
    return `<div class="toc-row ${cls}" style="${pad}"><span>${esc(l.text)}</span><span class="toc-dots"></span></div>`;
  }).join('\n');
}

function titlePageHtml(meta, workLabel) {
  const m = meta;
  return `
  <section class="doc-page title-page">
    <p class="tp-ministry">${esc((m.ministry || 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ').toUpperCase())}</p>
    <p class="tp-uni">${esc((m.university || 'НАИМЕНОВАНИЕ ОБРАЗОВАТЕЛЬНОЙ ОРГАНИЗАЦИИ').toUpperCase())}</p>
    ${(m.faculty || m.templateId === 'synergy') ? `<p class="tp-fac">${esc(m.faculty || '')}</p>` : ''}
    ${(m.department || m.templateId === 'synergy') ? `<p class="tp-dep">Кафедра: ${esc(m.department || '')}</p>` : ''}
    <div class="tp-spacer"></div>
    <p class="tp-type">${esc(workLabel.toUpperCase())}</p>
    <p class="tp-on">на тему:</p>
    <p class="tp-topic">«${esc(m.title || '')}»</p>
    <div class="tp-spacer sm"></div>
    <div class="tp-right">
      <p>Выполнил(а) обучающийся: ${esc(m.author || '____________________')}</p>
      ${m.group ? `<p>Группа: ${esc(m.group)}</p>` : ''}
      <p>Руководитель: ${esc(m.supervisor || '____________________')}</p>
    </div>
    <div class="tp-spacer"></div>
    <p class="tp-city">${esc(m.city || 'Москва')} ${esc(m.year || new Date().getFullYear())}</p>
  </section>`;
}

function taskSheetHtml(outline) {
  const tasks = (outline.tasks || []).map((t, i) => `<p>${i + 1}. ${esc(t)}</p>`).join('');
  return `
  <section class="doc-page">
    <h1 class="doc-h1">ЗАДАНИЕ НА ВЫПОЛНЕНИЕ РАБОТЫ</h1>
    <p>Тема работы: ${esc(outline.title)}.</p>
    <p>Объект исследования: ${esc(outline.object)}.</p>
    <p>Предмет исследования: ${esc(outline.subject)}.</p>
    <p>Цель работы: ${esc(outline.goal)}.</p>
    <p>Перечень подлежащих разработке вопросов (задачи исследования):</p>
    ${tasks}
    <p>Перечень структурных элементов: введение, основная часть (главы), заключение, список использованных источников, приложения.</p>
  </section>`;
}

const PRINT_CSS = `
@page { size: A4; margin: 20mm 10mm 20mm 30mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Times New Roman', Times, serif; font-size: 14pt; line-height: 1.5; color: #000; }
.doc-page { page-break-after: always; }
.title-page { text-align: center; }
.title-page p { margin: 0 0 4px; }
.tp-ministry, .tp-uni { font-size: 12pt; text-transform: uppercase; }
.tp-uni { font-weight: bold; margin-bottom: 8px !important; }
.tp-fac, .tp-dep { font-size: 12pt; }
.tp-spacer { height: 48mm; }
.tp-spacer.sm { height: 28mm; }
.tp-type { font-size: 16pt; font-weight: bold; text-transform: uppercase; margin: 12px 0 !important; }
.tp-on { font-size: 14pt; }
.tp-topic { font-size: 14pt; font-weight: bold; max-width: 140mm; margin: 8px auto !important; }
.tp-right { text-align: right; font-size: 14pt; }
.tp-right p { text-align: right; margin-bottom: 6px; }
.tp-city { font-size: 14pt; margin-top: 20mm !important; }
.doc-h1 { font-size: 16pt; font-weight: bold; text-align: center; text-transform: uppercase; margin: 0 0 12px; page-break-before: always; }
.doc-h1:first-child { page-break-before: auto; }
.doc-h2 { font-size: 14pt; font-weight: bold; text-align: center; margin: 14px 0 8px; }
.doc-body h1 { font-size: 16pt; font-weight: bold; text-align: center; text-transform: uppercase; margin: 0 0 12px; page-break-before: always; }
.doc-body h1:first-child { page-break-before: auto; }
.doc-body h2 { font-size: 14pt; font-weight: bold; text-align: center; margin: 14px 0 8px; }
.doc-body p { text-align: justify; text-indent: 15mm; margin: 0; line-height: 1.5; }
.doc-body p.ref { text-indent: 0; padding-left: 15mm; text-indent: -15mm; margin-bottom: 4px; }
.doc-body p.tcap { text-indent: 0; margin: 8px 0 2px; }
.doc-body p.fcap { text-indent: 0; text-align: center; margin: 4px 0 14px; font-size: 12pt; }
.doc-body p.fig { text-indent: 0; text-align: center; margin: 8px 0 4px; }
.doc-body p.fig img { max-width: 100%; height: auto; }
.doc-body table { width: 100%; border-collapse: collapse; margin: 4px 0 14px; font-size: 12pt; table-layout: fixed; }
.doc-body th, .doc-body td { border: 1px solid #000; padding: 4px 8px; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; hyphens: auto; }
.doc-body th { font-weight: bold; text-align: center; background: #f0f0f0; }
.doc-body td { text-align: left; }
.toc-title { font-size: 16pt; font-weight: bold; text-align: center; text-transform: uppercase; margin-bottom: 16px; }
.toc-row { display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; font-size: 14pt; }
.toc-h1 { font-weight: bold; margin-top: 6px; }
.toc-h2 { font-weight: normal; }
.toc-dots { flex: 1; border-bottom: 1px dotted #666; min-width: 20px; margin-bottom: 3px; }
@media screen {
  body { background: #888; padding: 20px; }
  .doc-page { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto 20px; padding: 20mm 10mm 20mm 30mm; box-shadow: 0 4px 24px rgba(0,0,0,.3); }
  .doc-body { background: #fff; width: 210mm; margin: 0 auto 20px; padding: 20mm 10mm 20mm 30mm; box-shadow: 0 4px 24px rgba(0,0,0,.3); }
}
`;

/**
 * Полный HTML-документ для печати/PDF: титул, задание, содержание, текст.
 */
export function buildFullHtml({ meta, cfg, outline, blocks, bodyHtml, workType }) {
  const m = resolveDocumentMeta(meta || {}, {
    workType,
    outline,
    cfg,
    topic: meta?.title,
  });
  const workLabel = m.workLabel || (cfg && cfg.label) || 'ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА';
  m.title = m.title || outline?.title || '';

  const toc = tocHtml(buildTocLines(blocks));
  const hasTask = cfg && cfg.hasTaskSheet;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<title>${esc(m.title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${titlePageHtml(m, workLabel)}
${hasTask ? taskSheetHtml(outline || {}) : ''}
<section class="doc-page">
  <div class="toc-title">СОДЕРЖАНИЕ</div>
  ${toc}
</section>
<section class="doc-body">
${bodyHtml || blocksToHtml(blocks)}
</section>
</body>
</html>`;
}
