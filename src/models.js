import 'dotenv/config';

const ENV_DEFAULT = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';

/** Доступные модели генерации (UI id → OpenRouter slug). */
export const GENERATION_MODELS = [
  {
    id: 'deepseek-v4',
    label: 'DeepSeek V4',
    slug: 'deepseek/deepseek-v4-flash',
    description: 'Быстрая модель, оптимальна для длинных текстов ВКР',
  },
  {
    id: 'gemini-3-pro',
    label: 'Gemini 3.1 Pro',
    slug: 'google/gemini-3.1-pro-preview',
    description: 'Google flagship — сильная структура и рассуждение',
  },
];

const byId = new Map(GENERATION_MODELS.map((m) => [m.id, m]));
const bySlug = new Map(GENERATION_MODELS.map((m) => [m.slug, m]));

export const DEFAULT_MODEL_ID = bySlug.get(ENV_DEFAULT)?.id
  || GENERATION_MODELS[0].id;

export function listModels() {
  return GENERATION_MODELS.map(({ id, label, description }) => ({ id, label, description }));
}

/** UI id или slug → OpenRouter slug (fallback: env OPENROUTER_MODEL). */
export function resolveModelSlug(requestModel) {
  if (!requestModel) return ENV_DEFAULT;
  if (byId.has(requestModel)) return byId.get(requestModel).slug;
  if (bySlug.has(requestModel)) return requestModel;
  if (typeof requestModel === 'string' && requestModel.includes('/')) return requestModel;
  console.warn(`[models] unknown model "${requestModel}", fallback to ${ENV_DEFAULT}`);
  return ENV_DEFAULT;
}

export function resolveModelLabel(requestModel) {
  if (byId.has(requestModel)) return byId.get(requestModel).label;
  if (bySlug.has(requestModel)) return bySlug.get(requestModel).label;
  return String(requestModel || ENV_DEFAULT);
}
