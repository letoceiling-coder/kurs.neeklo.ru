import { cleanText } from './textutil.js';
import { parserAvailable, parserSearch, verifyUrls } from './neekloSources.js';

const COMPANY_GOAL =
  'реквизиты организации: полное наименование, ИНН, ОГРН, КПП, юридический адрес, ОКВЭД, выручка, численность, виды деятельности, учредители';

const RUSPROFILE_CARD = /rusprofile\.ru\/id\/\d+/i;
const AUDIT_CARD = /audit-it\.ru\/contragent\//i;

function isAiTopic(text) {
  return /искусственн|интеллект|\bии\b|llm|нейросет|машинн\w*\s+обуч|generative|генератив|big\s*data|rag|ai[\s-]?agent/i.test(String(text || ''));
}

/** Разобрать URL предприятия из meta (переопределение автопоиска). */
export function parseCompanyUrls(meta) {
  const raw = meta?.companyUrls;
  if (Array.isArray(raw)) {
    return raw.map((u) => String(u).trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[\n,;]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  }
  return [];
}

/** Поисковый запрос для rusprofile / audit-it. */
export function buildCompanySearchQuery(topic, meta) {
  const name = cleanText(meta?.company || '');
  if (name) return name;

  const quoted = topic.match(/[«"']([^»"']{3,80})[»"']/);
  if (quoted) return cleanText(quoted[1]);

  const legal = topic.match(/\b((?:ООО|АО|ПАО|ЗАО)\s+[«"']?[^,.»"']{3,60})/i);
  if (legal) return cleanText(legal[1]);

  if (isAiTopic(topic)) {
    const k = cleanText(topic)
      .replace(/\b(разработк\w*|внедрен\w*|систем\w*|предприят\w*|метод\w*|средств\w*)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return k.slice(0, 100) || 'искусственный интеллект автоматизация бизнес-процессов';
  }

  if (/юридическ|правов|адвокат|нотариал|юрист|документооборот/i.test(topic)) {
    return 'юридическая компания оказание юридических услуг ООО';
  }

  const stop = new Set(['разработка', 'внедрение', 'система', 'системы', 'предприятия', 'предприятие', 'бизнес', 'процессов', 'процессы', 'автоматизация', 'автоматизации', 'методы', 'средства', 'исследование', 'анализ']);
  const words = cleanText(topic)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4 && !stop.has(w))
    .slice(0, 5);
  return words.join(' ') || 'информационные технологии';
}

function scoreProfileItem(item, query) {
  const url = item.url || '';
  const title = (item.title || '').toLowerCase();
  let score = 0;
  if (RUSPROFILE_CARD.test(url)) score += 12;
  if (AUDIT_CARD.test(url)) score += 12;
  if (/\/person\//i.test(url)) score -= 25;
  if (/\/buh_otchet\//i.test(url)) score -= 5;

  for (const t of query.toLowerCase().split(/\s+/).filter((x) => x.length > 2)) {
    if (title.includes(t)) score += 3;
  }
  if (/инн\s*\d{10}/i.test(title)) score += 4;
  if (/\bооо\b/i.test(title)) score += 2;
  return score;
}

function pickBestUrl(items, pattern, query) {
  const ranked = (items || [])
    .filter((i) => pattern.test(i.url || ''))
    .sort((a, b) => scoreProfileItem(b, query) - scoreProfileItem(a, query));
  return ranked[0]?.url || null;
}

/**
 * Найти и загрузить карточку предприятия через поиск на rusprofile.ru и audit-it.ru.
 * Ручные URL в meta.companyUrls — только переопределение.
 */
export async function discoverCompany({ topic, meta }, onProgress = () => {}) {
  const manualUrls = parseCompanyUrls(meta);
  if (manualUrls.length) {
    onProgress('Загружаю карточку предприятия…');
    const pages = await verifyUrls(manualUrls, { timeoutMs: 150000, goal: COMPANY_GOAL });
    return { pages, searchQuery: null, mode: 'manual' };
  }

  if (!(await parserAvailable())) {
    return { pages: [], searchQuery: null, mode: 'offline' };
  }

  const searchQuery = buildCompanySearchQuery(topic, meta);
  onProgress(`Поиск на rusprofile.ru: «${searchQuery.slice(0, 50)}»…`);

  let rusItems = [];
  let auditItems = [];
  try {
    rusItems = await parserSearch(
      'yandex',
      `site:rusprofile.ru ${searchQuery} ООО`,
      8,
      { timeoutMs: 90000 },
    );
  } catch (e) {
    console.warn('[company] rusprofile:', e.message);
  }

  onProgress('Поиск на audit-it.ru…');
  try {
    auditItems = await parserSearch(
      'yandex',
      `site:audit-it.ru ${searchQuery} ООО`,
      6,
      { timeoutMs: 90000 },
    );
  } catch (e) {
    console.warn('[company] audit-it:', e.message);
  }

  const urls = [...new Set([
    pickBestUrl(rusItems, RUSPROFILE_CARD, searchQuery),
    pickBestUrl(auditItems, AUDIT_CARD, searchQuery),
  ].filter(Boolean))];

  if (!urls.length) {
    onProgress('Пробую встроенный поиск rusprofile.ru…');
    try {
      const smart = await parserSearch('smart', searchQuery, 6, {
        timeoutMs: 120000,
        options: {
          url: 'https://www.rusprofile.ru',
          hint: 'найти организацию по названию или ИНН в поиске сайта',
        },
      });
      const u = pickBestUrl(smart, RUSPROFILE_CARD, searchQuery);
      if (u) urls.push(u);
    } catch (e) {
      console.warn('[company] smart:', e.message);
    }
  }

  if (!urls.length) {
    return { pages: [], searchQuery, mode: 'not_found' };
  }

  onProgress('Загружаю полную карточку предприятия…');
  const pages = await verifyUrls(urls, { timeoutMs: 150000, goal: COMPANY_GOAL });
  return { pages, searchQuery, mode: 'search', urls };
}
