/** Сквозная нумерация таблиц и рисунков по ГОСТ (через весь документ). */
export function numberBlocks(blocks) {
  let tableNo = 0;
  let figureNo = 0;
  return (blocks || []).map((b) => {
    if (b.kind === 'table') {
      tableNo += 1;
      return { ...b, gostTable: tableNo };
    }
    if (b.kind === 'figure') {
      figureNo += 1;
      return { ...b, gostFigure: figureNo };
    }
    return b;
  });
}

export function formatTableCaption(block) {
  const n = block.gostTable ?? block.number ?? '';
  const cap = block.caption ? ` – ${block.caption}` : '';
  return `Таблица ${n}${cap}`;
}

export function formatFigureCaption(block) {
  const n = block.gostFigure ?? block.number ?? '';
  const cap = block.caption ? ` – ${block.caption}` : '';
  return `Рисунок ${n}${cap}`;
}
