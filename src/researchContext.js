import { cleanText } from './textutil.js';
import { collectRealSources } from './neekloSources.js';
import { discoverCompany } from './companyResearch.js';
import { formatDataIntegrityBlock, getDataMode, isValidInn } from './dataIntegrity.js';
import {
  detectWorkDomain, isPedagogyDomain, pedagogyCompanyBlock,
} from './workDomain.js';

export { parseCompanyUrls } from './companyResearch.js';

/** Тема связана с ИИ / LLM / автоматизацией через нейросети. */
export function isAiTopic(text) {
  return /искусственн|интеллект|\bии\b|llm|нейросет|машинн\w*\s+обуч|generative|генератив|big\s*data|rag|ai[\s-]?agent/i.test(String(text || ''));
}

function pickContact(data) {
  const c = data?.contacts || {};
  return {
    inn: c.inn || '',
    kpp: c.kpp || '',
    ogrn: c.ogrn || '',
    address: c.address || '',
    website: Array.isArray(c.website) ? c.website[0] : c.website || '',
  };
}

function mergeCompanyPages(pages) {
  const ok = (pages || []).filter((p) => p && p.data);
  if (!ok.length) return null;

  const merged = {
    name: '',
    inn: '',
    kpp: '',
    ogrn: '',
    address: '',
    okved: '',
    revenue: '',
    employees: '',
    founded: '',
    summary: '',
    sections: [],
    urls: ok.map((p) => p.url || p.finalUrl).filter(Boolean),
  };

  for (const p of ok) {
    const d = p.data;
    if (!merged.name && d.title) merged.name = cleanText(d.title.replace(/\s*Москва.*$/i, ''));
    if (!merged.summary && d.summary) merged.summary = cleanText(d.summary);
    const contacts = pickContact(d);
    if (!merged.inn && contacts.inn) merged.inn = contacts.inn;
    if (!merged.kpp && contacts.kpp) merged.kpp = contacts.kpp;
    if (!merged.ogrn && contacts.ogrn) merged.ogrn = contacts.ogrn;
    if (!merged.address && contacts.address) merged.address = contacts.address;
    if (Array.isArray(d.sections)) {
      for (const s of d.sections) {
        const heading = cleanText(s.heading || '');
        const content = cleanText(s.content || '');
        if (!heading && !content) continue;
        const key = heading.toLowerCase();
        if (merged.sections.some((x) => x.heading.toLowerCase() === key)) continue;
        merged.sections.push({ heading, content });
        if (/выручк/i.test(content) && !merged.revenue) merged.revenue = content;
        if (/оквэд/i.test(content) && !merged.okved) merged.okved = content;
        if (/численност|сотрудник/i.test(content) && !merged.employees) merged.employees = content;
      }
    }
  }

  if (!merged.name && ok[0]?.title) {
    merged.name = cleanText(String(ok[0].title).split('(')[0]);
  }
  return merged;
}

/** Блок для промптов — только проверенные реквизиты. */
export function formatCompanyBlock(company, metaName) {
  const verified = company && isValidInn(company.inn);

  if (!verified) {
    const hint = metaName
      ? `Пользователь указал «${metaName}», но карточка с rusprofile/audit-it с ИНН не загружена.`
      : 'Карточка предприятия с rusprofile/audit-it не загружена.';
    return `${hint}
Объект исследования — организация отрасли (малый/средний бизнес), обобщённый кейс.
ЗАПРЕЩЕНО: придумывать ООО/АО с ИНН, ОГРН, выручкой, адресом.
Пиши: «на примере юридической компании малого бизнеса» или «на примере организации отрасли» — без конкретных реквизитов.`;
  }

  const lines = [
    `ВЕРИФИЦИРОВАННОЕ предприятие (данные rusprofile / audit-it — использовать ТОЛЬКО их, без подмены):`,
    company.name ? `Наименование: ${company.name}` : '',
    company.inn ? `ИНН: ${company.inn}` : '',
    company.kpp ? `КПП: ${company.kpp}` : '',
    company.ogrn ? `ОГРН: ${company.ogrn}` : '',
    company.address ? `Адрес: ${company.address}` : '',
    company.okved ? `ОКВЭД: ${company.okved}` : '',
    company.revenue ? `Финансовые показатели: ${company.revenue}` : '',
    company.employees ? `Численность: ${company.employees}` : '',
    company.summary ? `О деятельности: ${company.summary}` : '',
  ].filter(Boolean);

  for (const s of (company.sections || []).slice(0, 6)) {
    lines.push(`${s.heading}: ${s.content}`);
  }
  if (company.urls?.length) {
    lines.push(`Источники данных: ${company.urls.join('; ')}`);
  }
  lines.push('ЗАПРЕЩЕНО подменять это предприятие другим названием или вымышленным ИНН.');
  return lines.join('\n');
}

export function formatSourcesBlock(sources) {
  if (!sources?.length) {
    return 'Проверенных библиографических источников пока нет — не приводи конкретные цифры рынка без указания источника; допустимы обобщения «по данным отраслевых обзоров».';
  }
  return `Проверенные источники (цитируй по номерам [1], [2]… только из этого списка):\n${
    sources.map((s, i) => `[${i + 1}] ${s}`).join('\n')
  }`;
}

function formatPageAsGost(page) {
  const url = page.finalUrl || page.url;
  if (!url) return '';
  const title = cleanText(page.data?.title || page.title || 'Карточка контрагента');
  const today = new Date().toLocaleDateString('ru-RU');
  return `${title} [Электронный ресурс]. — URL: ${url} (дата обращения: ${today}).`;
}

/** Собрать контекст до генерации текста (RAG + поиск предприятия). */
export async function buildResearchContext({ topic, workType, meta }, onProgress = () => {}) {
  const companyName = cleanText(meta?.company || '');

  const ctx = {
    aiTopic: isAiTopic(topic),
    domain: detectWorkDomain(topic),
    company: null,
    dataMode: 'generic',
    integrityBlock: '',
    companyBlock: formatCompanyBlock(null, companyName),
    sources: [],
    sourceBlock: '',
    companyRefs: [],
    verified: 0,
    companySearch: null,
  };

  if (isPedagogyDomain(ctx.domain)) {
    ctx.dataMode = 'pedagogy';
    ctx.companyBlock = pedagogyCompanyBlock();
    ctx.integrityBlock = formatDataIntegrityBlock(ctx);
  } else {
  try {
    const found = await discoverCompany({ topic, meta }, onProgress);
    ctx.companySearch = found.searchQuery || found.mode;
    if (found.pages?.length) {
      ctx.company = mergeCompanyPages(found.pages);
      // Не подменяем верифицированное имя из карточки пользовательским вводом
      if (companyName && ctx.company && !isValidInn(ctx.company.inn)) {
        ctx.company.name = companyName;
      }
      ctx.dataMode = getDataMode(ctx.company);
      ctx.companyBlock = formatCompanyBlock(ctx.company, companyName);
      if (ctx.dataMode === 'verified') {
        ctx.companyRefs = found.pages.map(formatPageAsGost).filter(Boolean);
      }
    } else {
      ctx.dataMode = 'generic';
      ctx.companyBlock = formatCompanyBlock(null, companyName);
    }
  } catch (e) {
    console.warn('[research] company:', e.message);
    ctx.dataMode = 'generic';
    ctx.companyBlock = formatCompanyBlock(null, companyName);
  }

  ctx.integrityBlock = formatDataIntegrityBlock(ctx);
  }

  if (!ctx.integrityBlock) ctx.integrityBlock = formatDataIntegrityBlock(ctx);

  onProgress('Собираю научные источники по теме…');
  try {
    const need = workType === 'vkr' ? 22 : workType === 'coursework' ? 15 : 12;
    const res = await collectRealSources(topic, { need, onProgress });
    console.log(`[refs] parser: available=${res.available}, raw=${res.raw?.length || 0}, formatted=${res.sources?.length || 0}`);
    if (res.sources?.length) {
      ctx.sources = res.sources;
      ctx.verified = res.sources.length;
      ctx.sourceBlock = formatSourcesBlock(res.sources.slice(0, 18));
    }
  } catch (e) {
    console.warn('[research] sources:', e.message);
  }

  return ctx;
}

/** Дополнение system-промпта для тем про ИИ. */
export function aiTopicSystemExtra() {
  return `
ТЕМА СВЯЗАНА С ИСКУССТВЕННЫМ ИНТЕЛЛЕКТОМ — это РАЗРАБОТКА системы (не концепция):
- архитектура: ERP/учётная система → API Gateway → AI Orchestrator → LLM / RAG / ML → PostgreSQL + Vector DB;
- LLM-модуль технологически независим: DeepSeek, GigaChat, YandexGPT, GPT-4o — через единый шлюз (OpenRouter/API Gateway);
- RAG, embeddings, AI Agents, NLP; интеграция с ERP (1С), чат-интерфейс / Telegram-бот.
Обязательные артефакты разработки (описать текстом + таблицы, для приложений):
- BPMN: процесс «as-is» (ручная подготовка) и «to-be» (AI Agent → RAG → LLM → проверка экспертом);
- UML: Use Case, Component, Sequence (генерация документа);
- ER-модель БД: Users, Cases, Documents, Templates, KnowledgeBase, Embeddings, GenerationHistory.
Экономический эффект — только с формулой и исходными данными из карточки предприятия; без выдуманных «−40%» / «−70%».
Стиль: сухой научный, без маркетинговых клише.`;
}
