/**
 * Запуск/дожидание генерации ВКР через API (фоновая задача).
 * Usage: node scripts/finish-generation.mjs [--job-id UUID] [--poll]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const BASE = process.env.API_BASE || `http://127.0.0.1:${PORT}`;
const JOBS_DIR = process.env.JOBS_DIR || path.join(__dirname, '..', 'data', 'jobs');

const TOPIC = 'Посткроссинг как средство развития познавательного интереса дошкольников';
const FALLBACK_JOB = 'a1cd7a51-8155-44b4-87a3-76eeedfa63d6';

function loadJobRequest(jobId) {
  const p = path.join(JOBS_DIR, `${jobId}.json`);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return j.request || null;
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || data.raw || res.statusText);
  return data;
}

async function pollJob(jobId, maxMin = 90) {
  const deadline = Date.now() + maxMin * 60 * 1000;
  while (Date.now() < deadline) {
    const st = await api(`/api/generate/jobs/${jobId}`);
    console.log(`[${st.progress || 0}%] ${st.status} — ${st.message || ''}`);
    if (st.status === 'completed') {
      console.log('\n✓ Готово! docId:', st.docId);
      console.log('  Открыть: ' + BASE);
      return st;
    }
    if (st.status === 'failed') {
      throw new Error(st.error || 'Генерация failed');
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('Timeout ожидания генерации');
}

async function main() {
  const jobArg = process.argv.find((a) => a.startsWith('--job-id='))?.split('=')[1]
    || (process.argv.includes('--job-id') ? process.argv[process.argv.indexOf('--job-id') + 1] : null);

  const active = await api('/api/generate/jobs/active');
  if (active.active && active.job) {
    console.log('Уже идёт генерация:', active.job.id);
    await pollJob(active.job.id);
    return;
  }

  const prevReq = loadJobRequest(jobArg || FALLBACK_JOB);
  if (!prevReq?.outline) {
    console.log('Создаём новый план…');
    const outline = await api('/api/outline', {
      method: 'POST',
      body: JSON.stringify({ topic: TOPIC, workType: 'vkr' }),
    });
    prevReq = { topic: TOPIC, workType: 'vkr', outline, meta: { templateId: 'synergy' }, model: 'deepseek/deepseek-v4-flash' };
  } else {
    prevReq.model = prevReq.model || 'deepseek/deepseek-v4-flash';
    if (/gemini/i.test(prevReq.model)) prevReq.model = 'deepseek/deepseek-v4-flash';
  }

  console.log('Запуск генерации:', prevReq.topic?.slice(0, 60) + '…');
  console.log('Модель:', prevReq.model || '(default)');

  const { jobId } = await api('/api/generate/jobs', {
    method: 'POST',
    body: JSON.stringify(prevReq),
  });
  console.log('jobId:', jobId);
  await pollJob(jobId);
}

main().catch((e) => {
  console.error('[finish-generation]', e.message);
  process.exit(1);
});
