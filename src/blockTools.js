/**
 * Точечная работа с блоками документа без загрузки полного HTML.
 * Блоки — массив { kind, text?, rows?, caption? }.
 */

const TABLE_LEAK_RE = /\|[^|\n]{3,}\|[^|\n]{3,}\|/;

function splitTableCells(line) {
  return String(line || '').trim().split('|').map((c) => c.trim())
    .filter((c, idx, a) => !(c === '' && (idx === 0 || idx === a.length - 1)));
}

function isMarkdownSeparatorRow(line) {
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
}

/** Преобразовать markdown-строку таблицы в связный текст. */
export function demarkdownTableText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const s = line.trim();
      if (!/\|/.test(s)) return s;
      if (isMarkdownSeparatorRow(s)) return '';
      const cells = splitTableCells(s);
      if (cells.length >= 2) {
        return cells.filter((c) => c && !/^:?-{2,}:?$/.test(c)).join('; ');
      }
      return s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s*КОНЕЦ ТАБЛИЦЫ\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function hasMarkdownTableLeak(text) {
  return TABLE_LEAK_RE.test(String(text || ''));
}

/** Удалить/преобразовать markdown-таблицы, оставшиеся в абзацах после repair. */
export function stripMarkdownTableLeaksInBlocks(blocks) {
  const out = [];
  let stripped = 0;
  for (const b of blocks) {
    if (b.kind !== 'p' || !hasMarkdownTableLeak(b.text)) {
      out.push(b);
      continue;
    }
    const clean = demarkdownTableText(b.text);
    if (clean.length > 20) {
      out.push({ kind: 'p', text: clean });
      stripped += 1;
    }
  }
  if (stripped) console.log(`[tables] stripped markdown leaks from ${stripped} paragraph(s)`);
  return out;
}

/** Лёгкая сводка без полного текста. */
export function summarizeBlocks(blocks) {
  const byKind = {};
  let totalChars = 0;
  const indices = { h1: [], h2: [], p: [], table: [], ref: [] };
  blocks.forEach((b, i) => {
    byKind[b.kind] = (byKind[b.kind] || 0) + 1;
    if (indices[b.kind]) indices[b.kind].push(i);
    if (b.text) totalChars += b.text.length;
    if (b.rows) totalChars += JSON.stringify(b.rows).length;
  });
  return {
    total: blocks.length,
    byKind,
    totalChars,
    indices,
    tableLeaks: blocks.filter((b) => b.kind === 'p' && hasMarkdownTableLeak(b.text)).length,
  };
}

/** Прочитать один блок по индексу (без копирования всего массива). */
export function getBlock(blocks, index) {
  const b = blocks[index];
  if (!b) return null;
  return {
    index,
    kind: b.kind,
    text: b.text ? b.text.slice(0, 500) + (b.text.length > 500 ? '…' : '') : undefined,
    textLength: b.text?.length || 0,
    caption: b.caption,
    rowCount: b.rows?.length,
  };
}

/** Найти блоки по фильтру (kind, regex по text). */
export function findBlocks(blocks, { kind, pattern, max = 50 } = {}) {
  const re = pattern ? new RegExp(pattern, 'i') : null;
  const hits = [];
  for (let i = 0; i < blocks.length && hits.length < max; i += 1) {
    const b = blocks[i];
    if (kind && b.kind !== kind) continue;
    if (re && !re.test(b.text || b.caption || '')) continue;
    hits.push({ index: i, kind: b.kind, preview: (b.text || b.caption || '').slice(0, 120) });
  }
  return hits;
}

/** Точечное изменение блока (возвращает новый массив). */
export function patchBlockAt(blocks, index, patch) {
  if (index < 0 || index >= blocks.length) return blocks;
  const next = blocks.slice();
  next[index] = { ...next[index], ...patch };
  return next;
}

/** Удалить блок по индексу. */
export function removeBlockAt(blocks, index) {
  if (index < 0 || index >= blocks.length) return blocks;
  return blocks.filter((_, i) => i !== index);
}

/** Слова в блоках p/h1/h2. */
export function countWords(blocks) {
  const plain = blocks
    .filter((b) => b.kind === 'p' || b.kind === 'h1' || b.kind === 'h2')
    .map((b) => b.text || '')
    .join(' ');
  return plain.split(/\s+/).filter(Boolean).length;
}

/** Слова по главам (между h1). */
export function chapterWordCounts(blocks) {
  const chapters = [];
  let current = null;
  for (const b of blocks) {
    if (b.kind === 'h1' && /^ГЛАВА/i.test(b.text || '')) {
      if (current) chapters.push(current);
      current = { title: b.text, words: 0 };
    } else if (current && (b.kind === 'p' || b.kind === 'h2')) {
      current.words += (b.text || '').split(/\s+/).filter(Boolean).length;
    }
  }
  if (current) chapters.push(current);
  return chapters;
}
