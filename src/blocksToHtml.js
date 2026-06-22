import { numberBlocks, formatTableCaption, formatFigureCaption } from './gostNumbering.js';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Рендер блоков документа в HTML для редактора (A4-вид). */
export function blocksToHtml(blocks) {
  const numbered = numberBlocks(blocks);
  const out = [];
  for (const b of numbered) {
    switch (b.kind) {
      case 'h1':
        out.push(`<h1>${esc(b.text)}</h1>`);
        break;
      case 'h2':
        out.push(`<h2>${esc(b.text)}</h2>`);
        break;
      case 'p':
        out.push(`<p>${esc(b.text)}</p>`);
        break;
      case 'ref':
        out.push(`<p class="ref">${esc(b.text)}</p>`);
        break;
      case 'table': {
        out.push(`<p class="tcap">${esc(formatTableCaption(b))}</p>`);
        const rows = b.rows || [];
        const trs = rows.map((r, i) => {
          const tag = i === 0 ? 'th' : 'td';
          return `<tr>${r.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
        }).join('');
        out.push(`<table>${trs}</table>`);
        break;
      }
      case 'figure': {
        if (b.src) {
          out.push(`<p class="fig"><img src="${b.src}" alt="${esc(b.caption || '')}"/></p>`);
        }
        out.push(`<p class="fcap">${esc(formatFigureCaption(b))}</p>`);
        break;
      }
      default:
        if (b.text) out.push(`<p>${esc(b.text)}</p>`);
    }
  }
  return out.join('\n');
}
