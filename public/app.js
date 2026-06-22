'use strict';

const state = {
  workType: 'vkr',
  model: 'deepseek-v4',
  topic: '',
  outline: null,
  cfg: null,
  meta: {},
  templates: [],
  docId: null,
  jobId: null,
  pollTimer: null,
  jobActive: false,
  jobProgress: 0,
  jobMessage: '',
};

const JOB_KEY = 'diplom_active_job';

let MODEL_OPTIONS = [
  { id: 'deepseek-v4', label: 'DeepSeek V4', description: 'Быстрая модель для длинных текстов ВКР' },
  { id: 'gemini-3-pro', label: 'Gemini 3.1 Pro', description: 'Google flagship — сильная структура' },
];

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function showView(id) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#' + id).classList.add('active');
  if (id !== 'view-input') window.scrollTo({ top: 0, behavior: 'smooth' });
  updateGenBanner();
}

function updateGenBanner() {
  const bar = $('#genBanner');
  if (!bar) return;
  const onLoading = $('#view-loading').classList.contains('active');
  const show = state.jobActive && !onLoading;
  bar.hidden = !show;
  if (!show) return;
  $('#genBannerPct').textContent = Math.round(state.jobProgress || 0) + '%';
  $('#genBannerMsg').textContent = state.jobMessage || 'Генерация работы…';
}

function setJobProgress(progress, message) {
  state.jobProgress = progress ?? state.jobProgress;
  state.jobMessage = message ?? state.jobMessage;
  updateGenBanner();
}

function setJobActive(active) {
  state.jobActive = active;
  if (!active) {
    state.jobProgress = 0;
    state.jobMessage = '';
  }
  updateGenBanner();
}

function returnToGeneration() {
  showView('view-loading');
  if (state.jobId && !state.pollTimer) pollGeneration(state.jobId);
}

/** Перейти на главную и прокрутить к секции */
function goToSection(sectionId) {
  showView('view-input');
  history.replaceState(null, '', '#' + sectionId);
  requestAnimationFrame(() => {
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  });
}

function goHome() {
  showView('view-input');
  history.replaceState(null, '', location.pathname);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3800);
}

/* ===== ТИПЫ РАБОТ ===== */
async function loadTypes() {
  try {
    const res = await fetch('/api/types');
    const types = await res.json();
    const wrap = $('#typeChips');
    wrap.innerHTML = '';
    types.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === 0 ? ' active' : '');
      b.textContent = t.label;
      b.dataset.id = t.id;
      b.onclick = () => {
        $$('.chip').forEach((c) => c.classList.remove('active'));
        b.classList.add('active');
        state.workType = t.id;
      };
      wrap.appendChild(b);
    });
  } catch (e) {
    console.error(e);
  }
}

/* ===== МОДЕЛИ ИИ ===== */
function modelLabel(id) {
  const m = MODEL_OPTIONS.find((x) => x.id === id);
  return m ? m.label : id;
}

function updateModelBadge() {
  const badge = $('#topbarModelBadge');
  if (badge) badge.textContent = modelLabel(state.model) + ' • OpenRouter';
}

function renderModelChips(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  MODEL_OPTIONS.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip model-chip' + ((state.model === m.id || (!state.model && i === 0)) ? ' active' : '');
    b.textContent = m.label;
    b.title = m.description || '';
    b.dataset.id = m.id;
    b.onclick = () => selectModel(m.id, containerId);
    wrap.appendChild(b);
  });
}

function selectModel(id, sourceId) {
  state.model = id;
  updateModelBadge();
  ['modelChips', 'planModelChips'].forEach((cid) => renderModelChips(cid));
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) MODEL_OPTIONS = data;
    }
  } catch (e) {
    console.error(e);
  }
  renderModelChips('modelChips');
  renderModelChips('planModelChips');
  if (!state.model && MODEL_OPTIONS[0]) state.model = MODEL_OPTIONS[0].id;
  updateModelBadge();
}

function bindStaticModelChips() {
  document.querySelectorAll('#modelChips .chip[data-id]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.onclick = () => selectModel(btn.dataset.id, 'modelChips');
  });
}

/* ===== ШАБЛОНЫ ВУЗОВ ===== */
async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    state.templates = await res.json();
    const sel = $('#m_template');
    sel.innerHTML = state.templates.map((t) =>
      `<option value="${esc(t.id)}"${t.isDefault ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
    const def = state.templates.find((t) => t.isDefault) || state.templates.find((t) => t.id === 'synergy');
    if (def) applyTemplateFields(def.id, true);
    sel.onchange = () => applyTemplateFields(sel.value, true);
    applyPlaceholders(sel.value || def?.id || 'synergy');
  } catch (e) {
    console.error(e);
  }
}

function applyPlaceholders(templateId) {
  const tpl = state.templates.find((t) => t.id === templateId);
  const ph = tpl?.placeholders || {};
  const map = {
    m_university: ph.university,
    m_faculty: ph.faculty,
    m_department: ph.department,
    m_author: ph.author,
    m_group: ph.group,
    m_supervisor: ph.supervisor,
  };
  for (const [id, text] of Object.entries(map)) {
    const el = $('#' + id);
    if (el && text) el.placeholder = text;
  }
}

function applyTemplateFields(id, onlyEmpty) {
  const tpl = state.templates.find((t) => t.id === id);
  if (!tpl) return;
  const set = (elId, val) => {
    const el = $('#' + elId);
    if (!el || (onlyEmpty && el.value.trim())) return;
    el.value = val;
  };
  if (tpl.university) set('m_university', tpl.university);
  if (tpl.city) set('m_city', tpl.city);
  if (tpl.faculty) set('m_faculty', tpl.faculty);
  if (tpl.department) set('m_department', tpl.department);
  applyPlaceholders(id);
}

/* ===== META ===== */
$('#metaToggle').onclick = () => {
  const g = $('#metaGrid');
  const open = g.hidden;
  g.hidden = !open;
  $('#metaToggle').classList.toggle('open', open);
};

function collectMeta() {
  const get = (id) => ($('#' + id).value || '').trim();
  return {
    templateId: get('m_template') || 'synergy',
    university: get('m_university'),
    faculty: get('m_faculty'),
    department: get('m_department'),
    author: get('m_author'),
    group: get('m_group'),
    supervisor: get('m_supervisor'),
    city: get('m_city') || 'Москва',
    year: get('m_year') || String(new Date().getFullYear()),
    company: get('m_company'),
    companyUrls: get('m_company_urls'),
  };
}

/* ===== ШАГ 1 → ПЛАН ===== */
$('#startBtn').onclick = async () => {
  const topic = $('#topicInput').value.trim();
  if (!topic) { toast('Введите тему работы', true); $('#topicInput').focus(); return; }
  state.topic = topic;
  state.meta = collectMeta();
  if (!state.meta.title) state.meta.title = topic;

  const btn = $('#startBtn');
  btn.disabled = true;
  btn.innerHTML = 'Формирую план…';
  try {
    const res = await fetch('/api/outline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, workType: state.workType, model: state.model, meta: state.meta }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(res.ok ? 'Неверный ответ сервера' : (text.includes('<html') ? 'Сервер временно недоступен. Подождите минуту и повторите.' : text.slice(0, 120)));
    }
    if (!res.ok) throw new Error(data.error || 'Ошибка');
    state.outline = data.outline;
    state.meta.title = data.outline.title || topic;
    renderPlan();
    showView('view-plan');
    renderModelChips('planModelChips');
  } catch (e) {
    toast('Не удалось сформировать план: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Создать работу <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
};

/* ===== РЕНДЕР ПЛАНА ===== */
function renderPlan() {
  const o = state.outline;
  const card = $('#planCard');
  const field = (label, id, val, ta) => `
    <div class="plan-field">
      <label>${label}</label>
      ${ta ? `<textarea id="${id}" rows="2">${esc(val)}</textarea>`
           : `<input id="${id}" value="${esc(val)}" />`}
    </div>`;

  let chaptersHtml = '<div class="plan-field"><label>Главы и параграфы</label><div class="plan-chapters">';
  o.chapters.forEach((ch, ci) => {
    let subs = '';
    (ch.subsections || []).forEach((s, si) => {
      subs += `<input class="ch-sub" data-c="${ci}" data-s="${si}" value="${esc(s)}" />`;
    });
    chaptersHtml += `
      <div class="chapter-block">
        <div class="ch-head">
          <span class="ch-num">ГЛАВА ${ci + 1}</span>
          <input class="ch-title" data-c="${ci}" value="${esc(ch.title)}" />
        </div>
        ${subs ? `<div class="sub-list">${subs}</div>` : ''}
      </div>`;
  });
  chaptersHtml += '</div></div>';

  card.innerHTML =
    field('Тема работы', 'p_title', o.title) +
    field('Объект исследования', 'p_object', o.object, true) +
    field('Предмет исследования', 'p_subject', o.subject, true) +
    field('Цель работы', 'p_goal', o.goal, true) +
    field('Задачи (по одной в строке)', 'p_tasks', (o.tasks || []).join('\n'), true) +
    chaptersHtml;
}

function syncPlanFromUI() {
  const o = state.outline;
  o.title = $('#p_title').value.trim();
  o.object = $('#p_object').value.trim();
  o.subject = $('#p_subject').value.trim();
  o.goal = $('#p_goal').value.trim();
  o.tasks = $('#p_tasks').value.split('\n').map((s) => s.trim()).filter(Boolean);
  $$('.ch-title').forEach((inp) => {
    const ci = +inp.dataset.c;
    o.chapters[ci].title = inp.value.trim();
  });
  $$('.ch-sub').forEach((inp) => {
    const ci = +inp.dataset.c, si = +inp.dataset.s;
    o.chapters[ci].subsections[si] = inp.value.trim();
  });
  state.meta.title = o.title;
}

$('#planBack').onclick = () => showView('view-input');

$('#regenPlan').onclick = async () => {
  const btn = $('#regenPlan');
  btn.disabled = true; btn.textContent = 'Генерирую…';
  try {
    const res = await fetch('/api/outline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: state.topic, workType: state.workType, model: state.model, meta: state.meta }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.outline = data.outline;
    renderPlan();
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Сгенерировать другой план'; }
};

/* ===== ШАГ 2 → ГЕНЕРАЦИЯ (фоновая, с poll) ===== */
$('#genFullBtn').onclick = () => startGeneration();

async function startGeneration(existingJobId) {
  syncPlanFromUI();
  showView('view-loading');
  setProgress(0, 'Готовим работу…', 'Подключаемся к модели ' + modelLabel(state.model) + '…');
  $('#loaderLog').innerHTML = '';

  try {
    let jobId = existingJobId;
    if (!jobId) {
      const res = await fetch('/api/generate/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: state.topic, workType: state.workType, model: state.model,
          outline: state.outline, meta: state.meta,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.jobId) {
        jobId = data.jobId;
        toast('Подключаемся к текущей генерации…');
      } else if (!res.ok) {
        throw new Error(data.error || 'Ошибка запуска');
      } else {
        jobId = data.jobId;
      }
    }
    state.jobId = jobId;
    localStorage.setItem(JOB_KEY, jobId);
    setJobActive(true);
    pollGeneration(jobId);
  } catch (e) {
    setJobActive(false);
    toast('Ошибка генерации: ' + e.message, true);
    showView('view-plan');
    renderModelChips('planModelChips');
  }
}

function pollGeneration(jobId) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  const tick = async () => {
    try {
      const res = await fetch('/api/generate/jobs/' + jobId);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Задача не найдена');

      setProgress(job.progress || 0, job.message || 'Генерация…');
      setJobProgress(job.progress || 0, job.message || 'Генерация…');
      if (job.log && job.log.length) {
        $('#loaderLog').innerHTML = job.log.slice(-6).map((m) => `<li>${esc(m)}</li>`).join('');
      }

      if (job.status === 'completed') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        localStorage.removeItem(JOB_KEY);
        setJobActive(false);
        state.jobId = null;
        if (job.docId) {
          await openCompletedJob(job);
        } else {
          finishGeneration({
            id: job.docId,
            outline: job.result && job.result.outline,
            cfg: job.result && job.result.cfg,
            sources: job.result && job.result.sources,
            html: '',
          });
        }
      } else if (job.status === 'failed') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        localStorage.removeItem(JOB_KEY);
        setJobActive(false);
        state.jobId = null;
        throw new Error(job.error || 'Генерация прервана');
      }
    } catch (e) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      setJobActive(false);
      toast('Ошибка генерации: ' + e.message, true);
      showView('view-plan');
    renderModelChips('planModelChips');
    }
  };
  tick();
  state.pollTimer = setInterval(tick, 3000);
}

/** Восстановление после обновления страницы */
async function resumeActiveJob() {
  const savedId = localStorage.getItem(JOB_KEY);
  try {
    const res = await fetch('/api/generate/jobs/active');
    const data = await res.json();
    const jobId = (data.active && data.job && data.job.id) || savedId;
    if (!jobId) return;

    const jRes = await fetch('/api/generate/jobs/' + jobId);
    const job = await jRes.json();
    if (!jRes.ok || job.status === 'completed' || job.status === 'failed') {
      localStorage.removeItem(JOB_KEY);
      if (job.status === 'completed' && job.docId) {
        await openCompletedJob(job);
      }
      return;
    }

    showView('view-loading');
    setProgress(job.progress || 0, job.message || 'Генерация продолжается…', 'Можно обновлять страницу — процесс идёт на сервере');
    if (job.log && job.log.length) {
      $('#loaderLog').innerHTML = job.log.slice(-6).map((m) => `<li>${esc(m)}</li>`).join('');
    }
    state.jobId = jobId;
    setJobActive(true);
    setJobProgress(job.progress || 0, job.message || 'Генерация продолжается…');
    pollGeneration(jobId);
  } catch {
    localStorage.removeItem(JOB_KEY);
    setJobActive(false);
  }
}

function setProgress(pct, title, msg) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  $('#loaderPct').textContent = pct + '%';
  const C = 2 * Math.PI * 44;
  $('#ringFg').style.strokeDashoffset = String(C - (C * pct) / 100);
  if (title) $('#loaderTitle').textContent = title;
  if (msg !== undefined) $('#loaderMsg').textContent = msg;
}
function addLog(text) {
  const li = document.createElement('li');
  li.textContent = text;
  $('#loaderLog').appendChild(li);
  const log = $('#loaderLog');
  if (log.children.length > 6) log.removeChild(log.firstChild);
}

function finishGeneration(ev) {
  state.outline = ev.outline || state.outline;
  state.cfg = ev.cfg || state.cfg;
  state.docId = ev.id || null;
  if (ev.html) $('#paper').innerHTML = ev.html;
  showView('view-editor');
  if (ev.sources && ev.sources.verified > 0) {
    toast(`Работа готова и сохранена! ${ev.sources.verified} источников проверены парсером.`);
  } else {
    toast('Работа готова и сохранена в «Мои документы».');
  }
}

async function openCompletedJob(job) {
  if (job.docId) {
    await loadDocument(job.docId, true);
    if (job.result && job.result.sources) {
      toast(`Работа готова! ${job.result.sources.verified || 0} источников проверены парсером.`);
    } else {
      toast('Работа готова и сохранена в «Мои документы».');
    }
    return;
  }
  finishGeneration({
    id: job.docId,
    outline: job.result && job.result.outline,
    cfg: job.result && job.result.cfg,
    sources: job.result && job.result.sources,
    html: '',
  });
}

/* ===== РЕДАКТОР ===== */
$('#toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  $('#paper').focus();
  if (btn.dataset.cmd) {
    document.execCommand(btn.dataset.cmd, false, null);
  } else if (btn.dataset.block) {
    const tag = btn.dataset.block;
    document.execCommand('formatBlock', false, tag === 'p' ? 'P' : tag.toUpperCase());
  }
});

$('#editorBack').onclick = () => {
  if (confirm('Начать новую работу? Текущая работа уже сохранена в «Мои документы».')) {
    state.docId = null;
    showView('view-input');
  }
};

/* ===== СОХРАНЕНИЕ ===== */
async function saveDocument(silent) {
  const payload = {
    title: state.meta.title || state.topic || (state.outline && state.outline.title),
    workType: state.workType,
    html: $('#paper').innerHTML,
    meta: state.meta,
    cfg: state.cfg,
    outline: state.outline,
  };
  try {
    let res;
    if (state.docId) {
      res = await fetch('/api/documents/' + state.docId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch('/api/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');
    if (data.id) state.docId = data.id;
    if (!silent) toast('Документ сохранён');
    return true;
  } catch (e) {
    if (!silent) toast('Не удалось сохранить: ' + e.message, true);
    return false;
  }
}

$('#saveBtn').onclick = () => saveDocument(false);

/* ===== НАВИГАЦИЯ ШАПКИ ===== */
$('#navHome').onclick = () => goHome();
$('#navHome').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } };
$('#navHow').onclick = (e) => { e.preventDefault(); goToSection('how'); };
$('#navFeatures').onclick = (e) => { e.preventDefault(); goToSection('features'); };
$('#genBannerReturn').onclick = () => returnToGeneration();

/* ===== МОИ ДОКУМЕНТЫ ===== */
$('#navDocs').onclick = (e) => { e.preventDefault(); history.replaceState(null, '', '#docs'); openDocs(); };
$('#docsBack').onclick = () => goHome();

async function openDocs() {
  showView('view-docs');
  const list = $('#docsList');
  list.innerHTML = '<div class="docs-empty">Загрузка…</div>';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch('/api/documents', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Сервер вернул ' + res.status);
    const docs = await res.json();
    if (!Array.isArray(docs)) throw new Error('Неверный ответ сервера');
    renderDocs(docs);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Превышено время ожидания. Попробуйте обновить страницу.' : (e.message || 'Ошибка');
    list.innerHTML = `<div class="docs-empty">Не удалось загрузить список. ${esc(msg)}<br><button class="btn-ghost sm" id="docsRetry" type="button" style="margin-top:14px">Повторить</button></div>`;
    const retry = $('#docsRetry');
    if (retry) retry.onclick = () => openDocs();
  }
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function renderDocs(docs) {
  const list = $('#docsList');
  if (!docs || !docs.length) {
    list.innerHTML = '<div class="docs-empty">Пока нет сохранённых работ. Создайте первую на главной странице.</div>';
    return;
  }
  list.innerHTML = docs.map((d) => `
    <div class="doc-card" data-id="${esc(d.id)}">
      <div class="doc-main">
        <div class="doc-title">${esc(d.title)}</div>
        <div class="doc-meta">
          ${d.label ? `<span class="doc-tag">${esc(d.label)}</span>` : ''}
          <span>${fmtDate(d.updatedAt || d.createdAt)}</span>
          ${d.words ? `<span>~${d.words.toLocaleString('ru-RU')} слов</span>` : ''}
          ${d.sources && d.sources.verified > 0 ? `<span class="doc-verified">✓ ${d.sources.verified} проверенных источников</span>` : ''}
        </div>
      </div>
      <div class="doc-acts">
        <button class="btn-ghost sm" data-act="open" data-id="${esc(d.id)}">Открыть</button>
        <button class="btn-ghost sm" data-act="docx" data-id="${esc(d.id)}" data-title="${esc(d.title)}">Word</button>
        <button class="btn-ghost sm" data-act="pdf" data-id="${esc(d.id)}" data-title="${esc(d.title)}">PDF</button>
        <button class="btn-icon-del" data-act="del" data-id="${esc(d.id)}" title="Удалить">✕</button>
      </div>
    </div>`).join('');
}

$('#docsList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'open') {
    await loadDocument(id);
  } else if (btn.dataset.act === 'docx') {
    await downloadStored(id, 'docx', btn.dataset.title);
  } else if (btn.dataset.act === 'pdf') {
    await downloadStored(id, 'pdf', btn.dataset.title);
  } else if (btn.dataset.act === 'del') {
    if (!confirm('Удалить эту работу безвозвратно?')) return;
    try {
      const res = await fetch('/api/documents/' + id, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      btn.closest('.doc-card').remove();
      toast('Документ удалён');
      if (!$('#docsList').children.length) renderDocs([]);
    } catch { toast('Не удалось удалить', true); }
  }
});

async function downloadStored(id, type, title) {
  const ext = type === 'pdf' ? '.pdf' : '.docx';
  const label = type === 'pdf' ? 'PDF' : 'Word';
  toast('Готовлю ' + label + '…');
  try {
    const res = await fetch('/api/documents/' + id + '/export/' + type);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'Ошибка');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ((title || 'rabota').slice(0, 80)) + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(label + ' скачан');
  } catch (e) {
    toast('Не удалось скачать: ' + e.message, true);
  }
}

async function loadDocument(id, silent) {
  try {
    const res = await fetch('/api/documents/' + id);
    const doc = await res.json();
    if (!res.ok) throw new Error(doc.error || 'Ошибка');
    state.docId = doc.id;
    state.outline = doc.outline || {};
    state.cfg = doc.cfg || {};
    state.meta = doc.meta || {};
    state.workType = doc.workType || 'vkr';
    if (doc.meta && doc.meta.title) state.meta.title = doc.meta.title;
    $('#paper').innerHTML = doc.html || '';
    showView('view-editor');
    if (!silent) toast('Документ открыт');
  } catch (e) {
    toast('Не удалось открыть: ' + e.message, true);
  }
}

/* ===== ЭКСПОРТ ===== */
$('#docxBtn').onclick = async () => {
  const btn = $('#docxBtn');
  btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = 'Готовлю файл…';
  try {
    const res = await fetch('/api/export/docx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: $('#paper').innerHTML,
        meta: state.meta,
        cfg: state.cfg,
        outline: state.outline,
      }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Ошибка'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ((state.meta.title || 'rabota').slice(0, 80)) + '.docx';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Файл Word скачан');
  } catch (e) {
    toast('Не удалось скачать: ' + e.message, true);
  } finally {
    btn.disabled = false; btn.innerHTML = old;
  }
};

$('#pdfBtn').onclick = async () => {
  const btn = $('#pdfBtn');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Готовлю PDF…';
  try {
    const res = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: $('#paper').innerHTML,
        meta: state.meta,
        cfg: state.cfg,
        outline: state.outline,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'Ошибка генерации PDF');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ((state.meta.title || 'rabota').slice(0, 80)) + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('PDF с титулом и содержанием скачан');
  } catch (e) {
    toast('PDF: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
};

$('#previewBtn').onclick = async () => {
  try {
    const res = await fetch('/api/export/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: $('#paper').innerHTML,
        meta: state.meta,
        cfg: state.cfg,
        outline: state.outline,
      }),
    });
    if (!res.ok) throw new Error('Не удалось открыть предпросмотр');
    const html = await res.text();
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else toast('Разрешите всплывающие окна для предпросмотра', true);
  } catch (e) {
    toast(e.message, true);
  }
};

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* init */
bindStaticModelChips();
updateModelBadge();
loadTypes();
loadModels();
loadTemplates();
resumeActiveJob();

const hash = (location.hash || '').replace('#', '');
if (hash === 'how' || hash === 'features') goToSection(hash);
else if (hash === 'docs') openDocs();
