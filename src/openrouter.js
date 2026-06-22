import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveModelSlug, DEFAULT_MODEL_ID, listModels } from './models.js';
import { recordUsage } from './usageTracker.js';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const API_KEY = process.env.OPENROUTER_API_KEY;
const modelStore = new AsyncLocalStorage();

if (!API_KEY) {
  console.warn('[openrouter] ВНИМАНИЕ: не задан OPENROUTER_API_KEY в .env');
}

/** Выполнить fn с выбранной моделью (id или slug). */
export function runWithModel(modelId, fn) {
  return modelStore.run(resolveModelSlug(modelId), fn);
}

function activeModel(opts) {
  if (opts.model) return resolveModelSlug(opts.model);
  const ctx = modelStore.getStore();
  return ctx || resolveModelSlug();
}

/**
 * Вызов модели через OpenRouter (chat completions).
 */
export async function chat(messages, opts = {}) {
  const {
    temperature = 0.6,
    max_tokens = 4096,
    retries = 3,
    jsonMode = false,
  } = opts;

  const model = activeModel(opts);
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);

      const body = {
        model,
        messages,
        temperature,
        max_tokens,
      };
      if (jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      if (attempt === 1) console.log(`[openrouter] model=${model}`);

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://kurs.neeklo.ru',
          'X-Title': 'Diplomat AI',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 500)}`);
      }

      const data = await res.json();
      if (data?.usage) {
        try {
          recordUsage({ model: data.model || model, usage: data.usage });
        } catch { /* stats must not break generation */ }
      }
      const content = data?.choices?.[0]?.message?.content;
      const finish = data?.choices?.[0]?.finish_reason;
      if (!content || !String(content).trim()) {
        throw new Error('Пустой ответ модели: ' + JSON.stringify(data).slice(0, 300));
      }
      if (finish === 'length') {
        console.warn('[openrouter] ответ обрезан (length), max_tokens=' + max_tokens);
      }
      return content;
    } catch (err) {
      lastErr = err;
      console.warn(`[openrouter] попытка ${attempt}/${retries} не удалась: ${err.message}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw lastErr;
}

/** JSON-ответ с повторными попытками при ошибке парсинга. */
export async function chatJSON(messages, opts = {}) {
  const jsonRetries = opts.jsonRetries ?? 3;
  let lastErr;
  for (let i = 1; i <= jsonRetries; i++) {
    try {
      const raw = await chat(messages, {
        ...opts,
        temperature: opts.temperature ?? 0.35,
        max_tokens: opts.max_tokens ?? 4096,
        jsonMode: opts.jsonMode !== false,
      });
      return parseJSON(raw);
    } catch (err) {
      lastErr = err;
      console.warn(`[openrouter] JSON ${i}/${jsonRetries}: ${err.message}`);
      if (i < jsonRetries) await new Promise((r) => setTimeout(r, 1200 * i));
    }
  }
  throw lastErr;
}

export function parseJSON(raw) {
  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start > 0) text = text.slice(start);

  const lastObj = text.lastIndexOf('}');
  const lastArr = text.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end !== -1) text = text.slice(0, end + 1);

  const tryParse = (s) => JSON.parse(s);

  try {
    return tryParse(text);
  } catch {
    const cleaned = text.replace(/,\s*([}\]])/g, '$1');
    try {
      return tryParse(cleaned);
    } catch {
      let repaired = cleaned;
      const quotes = (repaired.match(/"/g) || []).length;
      if (quotes % 2 !== 0) repaired += '"';
      const opens = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
      const openo = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
      for (let i = 0; i < opens; i++) repaired += ']';
      for (let i = 0; i < openo; i++) repaired += '}';
      return tryParse(repaired);
    }
  }
}

export { DEFAULT_MODEL_ID, listModels, resolveModelSlug };
