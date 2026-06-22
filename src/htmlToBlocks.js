import { parse } from 'node-html-parser';
import { cleanText } from './textutil.js';

/**
 * Преобразует HTML из редактора в массив блоков для DOCX.
 */
export function htmlToBlocks(html) {
  const root = parse(html || '', { blockTextElements: { script: false, style: false } });
  const blocks = [];
  let pendingTableCaption = '';
  let pendingFigureSrc = '';
  let pendingFigureCaption = '';

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue; // только элементы
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      switch (tag) {
        case 'h1':
        case 'h2': {
          const text = cleanText(child.text);
          if (text) blocks.push({ kind: tag, text });
          break;
        }
        case 'h3':
        case 'h4': {
          const text = cleanText(child.text);
          if (text) blocks.push({ kind: 'h2', text });
          break;
        }
        case 'p':
        case 'div': {
          // contentEditable часто оборачивает всё в один div — разбираем вложенные блоки
          if (
            tag === 'div'
            && child.querySelector
            && child.querySelector('h1,h2,h3,h4,p,table,ul,ol')
          ) {
            walk(child);
            break;
          }
          const text = cleanText(child.text);
          // если внутри есть таблица — обрабатываем отдельно
          if (child.querySelector && child.querySelector('table')) {
            walk(child);
          } else if (child.querySelector && child.querySelector('img')) {
            walk(child);
          } else if (text) {
            const cls = child.getAttribute && (child.getAttribute('class') || '');
            if (/\btcap\b/.test(cls)) {
              const m = text.match(/^Таблица\s+\d+\s*[–-]\s*(.*)$/);
              pendingTableCaption = m ? m[1].trim() : text.replace(/^Таблица\s+\d+\s*/, '').trim();
              break;
            }
            if (/\bfcap\b/.test(cls)) {
              const m = text.match(/^Рисунок\s+\d+\s*[–-]\s*(.*)$/);
              const cap = m ? m[1].trim() : text.replace(/^Рисунок\s+\d+\s*/, '').trim();
              if (pendingFigureSrc) {
                blocks.push({ kind: 'figure', src: pendingFigureSrc, caption: cap || pendingFigureCaption });
                pendingFigureSrc = '';
                pendingFigureCaption = '';
              }
              break;
            }
            if (/\bfig\b/.test(cls) && child.querySelector('img')) {
              walk(child);
              break;
            }
            // признак источника: начинается с номера и точки и помечен классом
            if (/\bref\b/.test(cls) || /^\d+\.\s/.test(text)) {
              blocks.push({ kind: 'ref', text });
            } else {
              blocks.push({ kind: 'p', text });
            }
          }
          break;
        }
        case 'ul':
        case 'ol': {
          for (const li of child.querySelectorAll('li')) {
            const text = cleanText(li.text);
            if (text) blocks.push({ kind: 'p', text });
          }
          break;
        }
        case 'table': {
          const rows = [];
          for (const tr of child.querySelectorAll('tr')) {
            const cells = tr.querySelectorAll('th,td').map((c) => cleanText(c.text));
            if (cells.length) rows.push(cells);
          }
          if (rows.length) {
            const cap = child.querySelector('caption');
            blocks.push({
              kind: 'table',
              caption: pendingTableCaption || (cap ? cleanText(cap.text) : ''),
              rows,
            });
            pendingTableCaption = '';
          }
          break;
        }
        case 'img': {
          const src = child.getAttribute('src') || '';
          if (src) {
            pendingFigureSrc = src;
            pendingFigureCaption = child.getAttribute('alt') || '';
          }
          break;
        }
        default:
          walk(child);
      }
    }
  };

  walk(root);
  return blocks;
}
