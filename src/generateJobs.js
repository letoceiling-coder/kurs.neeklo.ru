import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateDocument } from './generator.js';
import { blocksToHtml } from './blocksToHtml.js';
import { createDocument } from './store.js';
import { runWithModel } from './openrouter.js';
import { resolveDocumentMeta } from './templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = process.env.JOBS_DIR || path.join(__dirname, '..', 'data', 'jobs');

function ensureDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobPath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

function isValidId(id) {
  return typeof id === 'string' && /^[a-f0-9-]{8,40}$/i.test(id);
}

function readJob(id) {
  if (!isValidId(id)) return null;
  const p = jobPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Быстро прочитать статус задачи без парсинга всего JSON (файл может быть 400KB+). */
function readJobHead(id) {
  if (!isValidId(id)) return null;
  const p = jobPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf-8', 0, n);
    const status = head.match(/"status"\s*:\s*"([^"]+)"/)?.[1];
    const progress = Number(head.match(/"progress"\s*:\s*(\d+)/)?.[1] || 0);
    const message = head.match(/"message"\s*:\s*"([^"]*)"/)?.[1] || '';
    const docId = head.match(/"docId"\s*:\s*"([^"]+)"/)?.[1] || null;
    const createdAt = head.match(/"createdAt"\s*:\s*"([^"]+)"/)?.[1] || '';
    if (!status) return null;
    return { id, status, progress, message, docId, createdAt };
  } catch {
    return null;
  }
}

function writeJob(job) {
  ensureDir();
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(jobPath(job.id), JSON.stringify(job), 'utf-8');
}

/** После рестарта: running → снова в очередь (не терять прогресс пользователя). */
export function recoverStaleJobs(onRequeue) {
  ensureDir();
  for (const f of fs.readdirSync(JOBS_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf-8'));
      if (job.status === 'running') {
        job.status = 'queued';
        job.error = null;
        job.message = 'Возобновление после перезапуска сервера…';
        job.startedAt = null;
        writeJob(job);
        if (onRequeue) onRequeue(job.id);
      } else if (job.status === 'queued' && onRequeue) {
        onRequeue(job.id);
      }
    } catch { /* skip */ }
  }
}

class GenerateJobManager {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  /** Создать задачу и поставить в очередь. */
  start(request) {
    ensureDir();
    const id = randomUUID();
    const job = {
      id,
      status: 'queued',
      request,
      progress: 0,
      message: 'В очереди…',
      log: [],
      result: null,
      docId: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    writeJob(job);
    this.queue.push(id);
    this.pump();
    return id;
  }

  /** Перезапустить failed-задачу с тем же request. */
  restart(id) {
    const job = readJob(id);
    if (!job || job.status !== 'failed' || !job.request) return null;
    if (this.getActive()) return null;
    return this.start(job.request);
  }

  get(id) {
    return readJob(id);
  }

  /** Вернуть queued-задачу в очередь после рестарта. */
  requeue(id) {
    const job = readJob(id);
    if (!job || job.status !== 'queued') return;
    if (!this.queue.includes(id)) this.queue.push(id);
    this.pump();
  }

  /** Активная задача (queued или running), самая свежая. */
  getActive() {
    ensureDir();
    let active = null;
    for (const f of fs.readdirSync(JOBS_DIR).filter((x) => x.endsWith('.json'))) {
      const id = f.replace(/\.json$/, '');
      const head = readJobHead(id);
      if (!head || (head.status !== 'queued' && head.status !== 'running')) continue;
      if (!active || head.createdAt > active.createdAt) active = head;
    }
    return active;
  }

  /** Лёгкий статус для poll (без html). */
  getStatus(id) {
    const head = readJobHead(id);
    if (!head) return null;
    if (head.status === 'completed' || head.status === 'failed') {
      const job = readJob(id);
      if (!job) return head;
      return {
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        log: job.log || [],
        docId: job.docId,
        error: job.error,
        finishedAt: job.finishedAt,
      };
    }
    const job = readJob(id);
    return job ? {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      log: job.log || [],
      docId: job.docId,
      error: job.error,
    } : head;
  }

  pump() {
    if (this.running || !this.queue.length) return;
    const id = this.queue.shift();
    const job = readJob(id);
    if (!job || job.status !== 'queued') {
      this.pump();
      return;
    }
    this.running = true;
    void this.runJob(job).finally(() => {
      this.running = false;
      this.pump();
    });
  }

  async runJob(job) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.message = 'Готовим работу…';
    writeJob(job);

    const { topic, workType, outline, meta, model } = job.request || {};

    try {
      const result = await runWithModel(model, () => generateDocument(
        { topic: (topic || '').trim(), workType: workType || 'vkr', outline, meta },
        (ev) => {
          const j = readJob(job.id);
          if (!j || j.status !== 'running') return;
          j.progress = ev.progress || j.progress;
          j.message = ev.message || j.message;
          if (ev.message && /готов|готова/i.test(ev.message)) {
            j.log = j.log || [];
            if (!j.log.includes(ev.message)) {
              j.log.push(ev.message);
              if (j.log.length > 20) j.log.shift();
            }
          }
          writeJob(j);
        },
      ));

      const html = blocksToHtml(result.blocks);
      const resolvedMeta = resolveDocumentMeta(meta || {}, {
        workType: workType || 'vkr',
        outline: result.outline,
        cfg: result.cfg,
        topic: (topic || '').trim(),
      });
      let docId = null;
      try {
        const rec = createDocument({
          title: resolvedMeta.title || result.outline.title,
          workType: workType || 'vkr',
          label: result.cfg && result.cfg.label,
          html,
          meta: resolvedMeta,
          cfg: result.cfg,
          outline: result.outline,
          sources: result.sources || null,
        });
        docId = rec.id;
      } catch (e) {
        console.error('[job] save document error', e);
      }

      const j = readJob(job.id);
      j.status = 'completed';
      j.progress = 100;
      j.message = 'Готово!';
      j.docId = docId;
      // html хранится в documents — не дублируем в job (файл остаётся лёгким)
      j.result = {
        outline: result.outline,
        cfg: result.cfg,
        sources: result.sources || null,
        meta: resolvedMeta,
      };
      j.finishedAt = new Date().toISOString();
      writeJob(j);
    } catch (err) {
      const j = readJob(job.id);
      j.status = 'failed';
      j.error = err instanceof Error ? err.message : String(err);
      j.finishedAt = new Date().toISOString();
      writeJob(j);
    }
  }
}

export const generateJobs = new GenerateJobManager();
