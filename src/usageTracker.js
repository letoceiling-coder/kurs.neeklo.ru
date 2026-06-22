import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_PATH = process.env.USAGE_STATS_PATH || path.join(__dirname, '..', 'data', 'usage-stats.json');
const DEFAULT_PROJECT = process.env.USAGE_PROJECT || 'kurs.neeklo.ru';
const RECENT_LIMIT = 500;

function emptyBucket() {
  return { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
}

function emptyStats() {
  return {
    updatedAt: null,
    project: DEFAULT_PROJECT,
    totals: emptyBucket(),
    byModel: {},
    byProject: {},
    byDay: {},
    recent: [],
  };
}

function ensureDir() {
  fs.mkdirSync(path.dirname(STATS_PATH), { recursive: true });
}

function loadStats() {
  if (!fs.existsSync(STATS_PATH)) return emptyStats();
  try {
    const data = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
    return { ...emptyStats(), ...data };
  } catch {
    return emptyStats();
  }
}

function saveStats(data) {
  ensureDir();
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATS_PATH, JSON.stringify(data), 'utf-8');
}

function bump(bucket, usage) {
  bucket.requests += 1;
  bucket.promptTokens += usage.prompt_tokens || 0;
  bucket.completionTokens += usage.completion_tokens || 0;
  bucket.totalTokens += usage.total_tokens || 0;
  if (usage.cost != null) bucket.cost += Number(usage.cost) || 0;
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Записать расход токенов после успешного вызова OpenRouter. */
export function recordUsage({ model, usage, project = DEFAULT_PROJECT }) {
  if (!model || !usage) return;
  const stats = loadStats();
  const entry = {
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
    cost: usage.cost,
  };

  bump(stats.totals, entry);
  if (!stats.byModel[model]) stats.byModel[model] = emptyBucket();
  bump(stats.byModel[model], entry);

  const proj = project || DEFAULT_PROJECT;
  if (!stats.byProject[proj]) stats.byProject[proj] = emptyBucket();
  bump(stats.byProject[proj], entry);

  const day = dayKey();
  if (!stats.byDay[day]) stats.byDay[day] = emptyBucket();
  bump(stats.byDay[day], entry);

  stats.recent.unshift({
    at: new Date().toISOString(),
    model,
    project: proj,
    promptTokens: entry.prompt_tokens,
    completionTokens: entry.completion_tokens,
    totalTokens: entry.total_tokens,
    cost: entry.cost ?? null,
  });
  if (stats.recent.length > RECENT_LIMIT) stats.recent.length = RECENT_LIMIT;

  saveStats(stats);
}

function sortBuckets(map) {
  return Object.entries(map || {})
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Полная статистика для страницы /usege. */
export function getUsageStats() {
  const stats = loadStats();
  const days = sortBuckets(stats.byDay).sort((a, b) => b.key.localeCompare(a.key));
  return {
    updatedAt: stats.updatedAt,
    project: stats.project || DEFAULT_PROJECT,
    totals: stats.totals,
    byModel: sortBuckets(stats.byModel),
    byProject: sortBuckets(stats.byProject),
    byDay: days,
    recent: stats.recent || [],
  };
}
