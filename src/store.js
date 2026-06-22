import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DOCS_DIR || path.join(__dirname, '..', 'data', 'documents');
const INDEX_PATH = path.join(path.dirname(DATA_DIR), 'documents-index.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function docPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function isValidId(id) {
  return typeof id === 'string' && /^[a-f0-9-]{8,40}$/i.test(id);
}

function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[«»"„""]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toListItem(rec) {
  return {
    id: rec.id,
    title: rec.title,
    workType: rec.workType,
    label: rec.label,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    words: rec.words || 0,
    sources: rec.sources || null,
    author: (rec.meta && rec.meta.author) || '',
  };
}

function dedupeListItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = normTitle(item.title);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, item);
      continue;
    }
    const a = item.updatedAt || item.createdAt || '';
    const b = prev.updatedAt || prev.createdAt || '';
    if (a >= b) map.set(key, item);
  }
  return [...map.values()].sort((a, b) =>
    (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
  );
}

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function writeIndex(items) {
  ensureDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(dedupeListItems(items)), 'utf-8');
}

/** Найти последний документ с такой же темой. */
export function findLatestByTitle(title) {
  const key = normTitle(title);
  if (!key) return null;
  ensureDir();
  let best = null;
  for (const f of fs.readdirSync(DATA_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      if (normTitle(rec.title) !== key) continue;
      if (!best || (rec.updatedAt || rec.createdAt) >= (best.updatedAt || best.createdAt)) {
        best = rec;
      }
    } catch { /* skip */ }
  }
  return best;
}

/** Удалить дубликаты на диске (оставить самый свежий по теме). */
export function dedupeDocuments() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  const keep = new Map();
  for (const f of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      if (!rec?.id) continue;
      const key = normTitle(rec.title);
      const prev = keep.get(key);
      if (!prev || (rec.updatedAt || rec.createdAt) >= (prev.updatedAt || prev.createdAt)) {
        keep.set(key, rec);
      }
    } catch { /* skip */ }
  }
  const keepIds = new Set([...keep.values()].map((r) => r.id));
  let removed = 0;
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    if (!keepIds.has(id)) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      removed++;
    }
  }
  return rebuildIndex();
}

/** Перестроить индекс из полных файлов. */
export function rebuildIndex() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  const items = [];
  for (const f of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      if (rec && rec.id) items.push(toListItem(rec));
    } catch { /* skip */ }
  }
  const deduped = dedupeListItems(items);
  writeIndex(deduped);
  return deduped;
}

function upsertIndex(rec) {
  let items = readIndex() || [];
  const item = toListItem(rec);
  items = items.filter((x) => x.id !== item.id && normTitle(x.title) !== normTitle(item.title));
  items.unshift(item);
  writeIndex(items);
}

function removeFromIndex(id) {
  const items = readIndex();
  if (!items) return;
  writeIndex(items.filter((x) => x.id !== id));
}

/**
 * Создать или обновить документ.
 * При совпадении темы обновляет существующий — без дубликатов в списке.
 */
export function createDocument({ title, workType, label, html, meta, cfg, outline, sources, replaceSameTitle = true } = {}) {
  ensureDir();
  const resolvedTitle = (title || (meta && meta.title) || (outline && outline.title) || 'Без названия').slice(0, 300);

  if (replaceSameTitle) {
    const existing = findLatestByTitle(resolvedTitle);
    if (existing) {
      return updateDocument(existing.id, {
        title: resolvedTitle,
        workType,
        label,
        html,
        meta,
        cfg,
        outline,
        sources,
      });
    }
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const plain = stripHtml(html);
  const record = {
    id,
    title: resolvedTitle,
    workType: workType || 'vkr',
    label: label || (cfg && cfg.label) || '',
    createdAt: now,
    updatedAt: now,
    words: plain ? plain.split(' ').filter(Boolean).length : 0,
    sources: sources || null,
    meta: meta || {},
    cfg: cfg || {},
    outline: outline || {},
    html: html || '',
  };
  fs.writeFileSync(docPath(id), JSON.stringify(record), 'utf-8');
  upsertIndex(record);
  return record;
}

/** Полная запись документа или null. */
export function getDocument(id) {
  if (!isValidId(id)) return null;
  const p = docPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Обновить документ. */
export function updateDocument(id, patch = {}) {
  const rec = getDocument(id);
  if (!rec) return null;
  if (patch.html != null) {
    rec.html = patch.html;
    const plain = stripHtml(patch.html);
    rec.words = plain ? plain.split(' ').filter(Boolean).length : 0;
  }
  if (patch.title != null) rec.title = String(patch.title).slice(0, 300);
  if (patch.workType != null) rec.workType = patch.workType;
  if (patch.label != null) rec.label = patch.label;
  if (patch.meta) rec.meta = patch.meta;
  if (patch.cfg) rec.cfg = patch.cfg;
  if (patch.outline) rec.outline = patch.outline;
  if (patch.sources !== undefined) rec.sources = patch.sources;
  rec.updatedAt = new Date().toISOString();
  fs.writeFileSync(docPath(id), JSON.stringify(rec), 'utf-8');
  upsertIndex(rec);
  return rec;
}

/** Удалить документ. */
export function deleteDocument(id) {
  if (!isValidId(id)) return false;
  const p = docPath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  removeFromIndex(id);
  return true;
}

/** Список документов (без дубликатов по теме). */
export function listDocuments() {
  const cached = readIndex();
  if (cached && cached.length) return dedupeListItems(cached);
  return rebuildIndex();
}
