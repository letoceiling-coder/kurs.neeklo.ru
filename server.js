import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateOutline, generateDocument, WORK_TYPES } from './src/generator.js';
import { buildDocx } from './src/docx.js';
import { buildPdf } from './src/pdf.js';
import { buildFullHtml } from './src/fullDocument.js';
import { blocksToHtml } from './src/blocksToHtml.js';
import { htmlToBlocks } from './src/htmlToBlocks.js';
import { safeFileName } from './src/textutil.js';
import { listTemplates, resolveDocumentMeta } from './src/templates.js';
import {
  createDocument, getDocument, updateDocument, deleteDocument, listDocuments, rebuildIndex, dedupeDocuments,
} from './src/store.js';
import { generateJobs, recoverStaleJobs } from './src/generateJobs.js';
import { runWithModel, listModels } from './src/openrouter.js';
import { getUsageStats } from './src/usageTracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

recoverStaleJobs((id) => generateJobs.requeue(id));
try {
  dedupeDocuments();
} catch (e) {
  console.error('dedupeDocuments', e);
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** Всегда JSON для ошибок API */
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Неверный формат запроса (JSON)' });
  }
  if (req.path.startsWith('/api/')) {
    console.error('API error', req.path, err);
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  }
  next(err);
});

function downloadName(meta, outline, ext) {
  return safeFileName((meta && meta.title) || (outline && outline.title) || 'rabota') + ext;
}

/** Типы работ для UI */
app.get('/api/types', (req, res) => {
  res.json(Object.entries(WORK_TYPES).map(([id, v]) => ({ id, label: v.label })));
});

app.get('/api/models', (req, res) => {
  res.json(listModels());
});

/** Шаблоны титульных листов вузов */
app.get('/api/templates', (req, res) => {
  res.json(listTemplates());
});

/** Генерация только плана (содержания) */
app.post('/api/outline', async (req, res) => {
  try {
    const { topic, workType, meta, model } = req.body || {};
    if (!topic || !topic.trim()) return res.status(400).json({ error: 'Укажите тему работы' });
    const outline = await runWithModel(model, () => generateOutline({
      topic: topic.trim(), workType: workType || 'vkr', meta,
    }));
    res.json({ outline });
  } catch (e) {
    console.error('outline error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Запуск фоновой генерации (переживает обновление страницы) */
app.post('/api/generate/jobs', (req, res) => {
  try {
    const { topic, workType, outline, meta, model } = req.body || {};
    if (!topic && !outline) {
      return res.status(400).json({ error: 'Не указана тема или план' });
    }
    const active = generateJobs.getActive();
    if (active) {
      return res.status(409).json({
        error: 'Уже идёт генерация',
        jobId: active.id,
        status: active.status,
      });
    }
    const jobId = generateJobs.start({ topic, workType, outline, meta, model });
    res.status(202).json({ jobId, status: 'queued', poll: `/api/generate/jobs/${jobId}` });
  } catch (e) {
    console.error('generate job error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Активная задача генерации (для восстановления после refresh) */
app.get('/api/generate/jobs/active', (req, res) => {
  const job = generateJobs.getActive();
  if (!job) return res.json({ active: false });
  res.json({ active: true, job: publicJob(job) });
});

/** Статус задачи генерации (лёгкий, без html) */
app.get('/api/generate/jobs/:id', (req, res) => {
  const job = generateJobs.getStatus(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(publicJob(job));
});

function publicJob(job) {
  const out = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    log: job.log || [],
    docId: job.docId,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
  if (job.status === 'completed' && job.result) {
    out.result = {
      outline: job.result.outline,
      cfg: job.result.cfg,
      sources: job.result.sources,
      meta: job.result.meta,
    };
  }
  return out;
}

/** Потоковая генерация (legacy, для совместимости) */
app.post('/api/generate', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (obj) => {
    res.write(JSON.stringify(obj) + '\n');
  };

  try {
    const { topic, workType, outline, meta, model } = req.body || {};
    if (!topic && !outline) {
      send({ type: 'error', message: 'Не указана тема' });
      return res.end();
    }

    const result = await runWithModel(model, () => generateDocument(
      { topic: (topic || '').trim(), workType: workType || 'vkr', outline, meta },
      (ev) => send({ type: 'progress', ...ev }),
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
      console.error('save document error', e);
    }

    send({
      type: 'done',
      id: docId,
      outline: result.outline,
      cfg: result.cfg,
      sources: result.sources || null,
      html,
      meta: resolvedMeta,
    });
  } catch (e) {
    console.error('generate error', e);
    send({ type: 'error', message: e.message });
  } finally {
    res.end();
  }
});

/** Экспорт в DOCX из HTML редактора */
app.post('/api/export/docx', async (req, res) => {
  try {
    const { html, meta, cfg, outline, workType } = req.body || {};
    const blocks = htmlToBlocks(html || '');
    const buf = await buildDocx({
      blocks,
      meta: meta || {},
      cfg: cfg || { label: 'Выпускная квалификационная работа', hasTaskSheet: true },
      outline: outline || {},
      workType: workType || 'vkr',
    });
    const fname = downloadName(meta, outline, '.docx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(buf);
  } catch (e) {
    console.error('export docx error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Экспорт в PDF (титул + задание + содержание + текст) */
app.post('/api/export/pdf', async (req, res) => {
  try {
    const { html, meta, cfg, outline, workType } = req.body || {};
    const buf = await buildPdf({ html, meta, cfg, outline, workType: workType || 'vkr' });
    const fname = downloadName(meta, outline, '.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(buf);
  } catch (e) {
    console.error('export pdf error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Полный HTML для предпросмотра/печати */
app.post('/api/export/preview', async (req, res) => {
  try {
    const { html, meta, cfg, outline, workType } = req.body || {};
    const blocks = htmlToBlocks(html || '');
    const fullHtml = buildFullHtml({ meta, cfg, outline, blocks, bodyHtml: html, workType: workType || 'vkr' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fullHtml);
  } catch (e) {
    console.error('preview error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Список сохранённых документов */
app.get('/api/documents', (req, res) => {
  try {
    res.json(listDocuments());
  } catch (e) {
    console.error('list documents error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Скачать DOCX сохранённого документа */
app.get('/api/documents/:id/export/docx', async (req, res) => {
  try {
    const doc = getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    const blocks = htmlToBlocks(doc.html || '');
    const buf = await buildDocx({
      blocks,
      meta: doc.meta || {},
      cfg: doc.cfg || { label: 'Выпускная квалификационная работа', hasTaskSheet: true },
      outline: doc.outline || {},
      workType: doc.workType,
    });
    const fname = downloadName(doc.meta, doc.outline, '.docx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(buf);
  } catch (e) {
    console.error('export docx by id error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Скачать PDF сохранённого документа */
app.get('/api/documents/:id/export/pdf', async (req, res) => {
  try {
    const doc = getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    const buf = await buildPdf({
      html: doc.html,
      meta: doc.meta,
      cfg: doc.cfg,
      outline: doc.outline,
      workType: doc.workType,
    });
    const fname = downloadName(doc.meta, doc.outline, '.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(buf);
  } catch (e) {
    console.error('export pdf by id error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Получить один документ целиком */
app.get('/api/documents/:id', (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  res.json(doc);
});

/** Создать/сохранить документ из редактора */
app.post('/api/documents', (req, res) => {
  try {
    const { title, workType, html, meta, cfg, outline, sources } = req.body || {};
    const rec = createDocument({ title, workType, html, meta, cfg, outline, sources });
    res.json({ id: rec.id, createdAt: rec.createdAt });
  } catch (e) {
    console.error('create document error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Обновить документ (правки из редактора) */
app.put('/api/documents/:id', (req, res) => {
  try {
    const { html, title, meta, cfg, outline } = req.body || {};
    const rec = updateDocument(req.params.id, { html, title, meta, cfg, outline });
    if (!rec) return res.status(404).json({ error: 'Документ не найден' });
    res.json({ id: rec.id, updatedAt: rec.updatedAt });
  } catch (e) {
    console.error('update document error', e);
    res.status(500).json({ error: e.message });
  }
});

/** Удалить документ */
app.delete('/api/documents/:id', (req, res) => {
  const ok = deleteDocument(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Документ не найден' });
  res.json({ ok: true });
});

/** Статистика расхода токенов (страница /usege, без публичных ссылок) */
app.get('/api/usage', (req, res) => {
  res.json(getUsageStats());
});

app.get('/usege', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'usege', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Diplomat AI запущен:  http://localhost:${PORT}\n`);
});
