import 'dotenv/config';
import { cleanText } from './textutil.js';

const API_URL = (process.env.NEEKLO_API_URL || 'https://api.neeklo.ru').replace(/\/+$/, '');
const PARSER_KEY = process.env.NEEKLO_PARSER_KEY || '';
const ENABLED = (process.env.NEEKLO_SOURCES || 'on').toLowerCase() !== 'off';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Parser-Key': PARSER_KEY,
  'x-api-key': PARSER_KEY,
};

/** Доступен ли парсер (ПК онлайн, CDP поднят). */
export async function parserAvailable(timeoutMs = 6000) {
  if (!ENABLED || !PARSER_KEY) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API_URL}/parser/health`, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json();
    return Boolean(j && j.success && j.cdp);
  } catch {
    return false;
  }
}

async function startJob(body) {
  const res = await fetch(`${API_URL}/parser/jobs`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (res.status !== 202 && !res.ok) {
    throw new Error(`parser start ${res.status}`);
  }
  const j = await res.json();
  if (!j.jobId) throw new Error('no jobId');
  return j.jobId;
}

async function pollJob(jobId, { timeoutMs = 180000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(`${API_URL}/parser/jobs/${jobId}`, { headers: HEADERS });
    if (!res.ok) continue;
    const j = await res.json();
    const job = j.job;
    if (!job) continue;
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.error || 'parser job failed');
  }
  throw new Error('parser job timeout');
}

/** Скачать items (JSONL) завершённой parse-задачи. */
async function downloadItems(jobId) {
  const res = await fetch(`${API_URL}/parser/jobs/${jobId}/download`, { headers: HEADERS });
  if (!res.ok) return [];
  const text = await res.text();
  const items = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      items.push(JSON.parse(s));
    } catch {
      /* пропускаем битые строки */
    }
  }
  return items;
}

/** Запустить parse-адаптер и вернуть элементы (yandex, smart, cyberleninka, …). */
export async function parserSearch(source, query, limit, opts = {}) {
  const jobId = await startJob({ mode: 'parse', source, query, limit, options: opts.options });
  await pollJob(jobId, opts);
  return downloadItems(jobId);
}

async function runParse(source, query, limit, opts = {}) {
  return parserSearch(source, query, limit, opts);
}

function pick(data, keys) {
  for (const k of keys) {
    const v = data && data[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** Нормализовать ParseItem парсера в единый источник. */
function normalizeItem(item, sourceType) {
  const d = item.data || {};
  const title = cleanText(item.title || pick(d, ['title', 'name', 'heading']) || '');
  if (!title) return null;
  return {
    type: sourceType,
    title,
    url: item.url || pick(d, ['url', 'link']) || null,
    author: cleanText(pick(d, ['authors', 'author', 'creators'])),
    year: pick(d, ['year', 'date', 'published', 'publishedAt']).match(/\d{4}/)?.[0] || '',
    journal: cleanText(pick(d, ['journal', 'source', 'publisher', 'edition'])),
  };
}

/** Оформить источник по ГОСТ Р 7.0.100–2018 (упрощённо, но корректно). */
export function formatGost(src) {
  const parts = [];
  if (src.author) {
    // «Фамилия И. О.» в начало, если это явно автор
    parts.push(src.author.replace(/\s+/g, ' ').trim());
  }
  let body = src.title;
  if (src.journal) body += ` // ${src.journal}`;
  if (src.year) body += `. — ${src.year}`;
  parts.push(body);
  let ref = parts.join(src.author ? '. ' : '');
  if (src.url) {
    const today = new Date().toLocaleDateString('ru-RU');
    ref += `. — URL: ${src.url} (дата обращения: ${today})`;
  }
  ref = ref.replace(/\.\.+/g, '.').trim();
  if (!/[.]$/.test(ref)) ref += '.';
  return ref;
}

/**
 * Собрать реальные источники по теме через парсер.
 * @returns {Promise<{available:boolean, sources:string[], raw:object[]}>}
 */
export async function collectRealSources(topic, { need = 20, onProgress = () => {} } = {}) {
  if (!ENABLED || !PARSER_KEY) return { available: false, sources: [], raw: [] };

  const available = await parserAvailable();
  if (!available) return { available: false, sources: [], raw: [] };

  const query = cleanText(topic).slice(0, 200);
  const plan = [
    { source: 'pravo', type: 'law', limit: Math.min(8, Math.ceil(need * 0.2)), query: 'цифровая экономика информационные технологии' },
    { source: 'cyberleninka', type: 'article', limit: Math.ceil(need * 0.45) },
    { source: 'moluch', type: 'article', limit: Math.ceil(need * 0.25) },
    { source: 'dissercat', type: 'dissertation', limit: Math.ceil(need * 0.1) },
  ];

  const raw = [];
  for (const step of plan) {
    try {
      onProgress(`Ищу реальные источники: ${step.source}…`);
      const q = step.source === 'pravo'
        ? topic.slice(0, 120)
        : query;
      const items = await runParse(step.source, q, step.limit, { timeoutMs: 120000 });
      for (const it of items) {
        const n = normalizeItem(it, step.type);
        if (n) raw.push(n);
      }
    } catch (e) {
      // один источник упал — продолжаем с остальными
      console.warn(`[neeklo] ${step.source}: ${e.message}`);
    }
    if (raw.length >= need) break;
  }

  // дедуп по заголовку
  const seen = new Set();
  const unique = [];
  for (const r of raw) {
    const key = r.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }

  const sources = unique.map(formatGost).filter(Boolean);
  return { available: true, sources, raw: unique };
}

/** Проверить существование конкретных URL (режим urls). */
export async function verifyUrls(urls, { timeoutMs = 120000, goal } = {}) {
  if (!ENABLED || !PARSER_KEY || !urls?.length) return [];
  try {
    const jobId = await startJob({
      mode: 'urls',
      urls: urls.slice(0, 20),
      goal: goal || 'библиографические данные: автор, название, издательство, год',
    });
    const job = await pollJob(jobId, { timeoutMs });
    const pages = job.result?.pages || [];
    return pages.filter((p) => p.ok).map((p) => ({ url: p.finalUrl || p.url, data: p.data, title: p.title }));
  } catch (e) {
    console.warn('[neeklo] verifyUrls:', e.message);
    return [];
  }
}

export const NEEKLO_ENABLED = ENABLED && Boolean(PARSER_KEY);
