import { cleanText } from './textutil.js';

/** Шаблон по умолчанию (Synergy / LMS). */
export const DEFAULT_TEMPLATE_ID = 'synergy';

const WORK_TYPE_LABELS = {
  vkr: 'ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА',
  coursework: 'КУРСОВАЯ РАБОТА',
  referat: 'РЕФЕРАТ',
  report: 'ДОКЛАД',
};

/** Шаблоны титульных листов и метаданные вузов */
export const UNIVERSITY_TEMPLATES = {
  standard: {
    id: 'standard',
    label: 'Стандарт ГОСТ (универсальный)',
    ministry: 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ',
    university: '',
    defaults: { city: 'Москва' },
    placeholders: {
      university: 'Полное наименование вуза',
      faculty: 'Факультет',
      department: 'Кафедра',
      author: 'Иванов Иван Иванович',
      group: 'БД-101',
      supervisor: 'к.э.н., доцент Петров П. П.',
    },
    workLabel: null,
  },
  synergy: {
    id: 'synergy',
    label: 'Университет «Синергия» (LMS)',
    ministry: 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ',
    university: 'МОСКОВСКИЙ ФИНАНСОВО-ПРОМЫШЛЕННЫЙ УНИВЕРСИТЕТ «СИНЕРГИЯ»',
    defaults: {
      city: 'Москва',
      faculty: '',
      department: '',
    },
    placeholders: {
      faculty: 'Факультет информационных технологий',
      department: 'Кафедра прикладной информатики',
      author: 'Иванов Иван Иванович',
      group: 'БД-101',
      supervisor: 'к.э.н., доцент Петров Петр Петрович',
    },
    workLabel: 'ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА',
    workLabels: WORK_TYPE_LABELS,
  },
  hse: {
    id: 'hse',
    label: 'НИУ ВШЭ',
    ministry: 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ',
    university: 'НАЦИОНАЛЬНЫЙ ИССЛЕДОВАТЕЛЬСКИЙ УНИВЕРСИТЕТ «ВЫСШАЯ ШКОЛА ЭКОНОМИКИ»',
    defaults: { city: 'Москва' },
    placeholders: {
      faculty: 'Факультет',
      department: 'Кафедра',
      author: 'Иванов И. И.',
      supervisor: 'к.э.н., доцент ...',
    },
    workLabel: 'ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА',
    workLabels: WORK_TYPE_LABELS,
  },
  ranepa: {
    id: 'ranepa',
    label: 'РАНХиГС',
    ministry: 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ',
    university: 'РОССИЙСКАЯ АКАДЕМИЯ НАРОДНОГО ХОЗЯЙСТВА И ГОСУДАРСТВЕННОЙ СЛУЖБЫ ПРИ ПРЕЗИДЕНТЕ РОССИЙСКОЙ ФЕДЕРАЦИИ',
    defaults: { city: 'Москва' },
    placeholders: {
      faculty: 'Институт / факультет',
      department: 'Кафедра',
      author: 'Иванов И. И.',
      supervisor: 'к.э.н., доцент ...',
    },
    workLabel: 'ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА',
    workLabels: WORK_TYPE_LABELS,
  },
  mgu: {
    id: 'mgu',
    label: 'МГУ им. Ломоносова',
    ministry: 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ',
    university: 'МОСКОВСКИЙ ГОСУДАРСТВЕННЫЙ УНИВЕРСИТЕТ ИМЕНИ М. В. ЛОМОНОСОВА',
    defaults: { city: 'Москва' },
    placeholders: {
      faculty: 'Факультет',
      department: 'Кафедра',
      author: 'Иванов И. И.',
      supervisor: 'к.э.н., доцент ...',
    },
    workLabel: 'ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА',
    workLabels: WORK_TYPE_LABELS,
  },
  rudn: {
    id: 'rudn',
    label: 'РУДН',
    ministry: 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ',
    university: 'РОССИЙСКИЙ УНИВЕРСИТЕТ ДРУЖБЫ НАРОДОВ ИМЕНИ ПАТРИСА ЛУМУМБЫ',
    defaults: { city: 'Москва' },
    placeholders: {
      faculty: 'Факультет',
      department: 'Кафедра',
      author: 'Иванов И. И.',
      supervisor: 'к.э.н., доцент ...',
    },
    workLabel: 'ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА',
    workLabels: WORK_TYPE_LABELS,
  },
};

function pickTemplate(templateId) {
  return UNIVERSITY_TEMPLATES[templateId] || UNIVERSITY_TEMPLATES[DEFAULT_TEMPLATE_ID] || UNIVERSITY_TEMPLATES.standard;
}

/** Применить шаблон к meta (не перезаписывает заполненные поля пользователя). */
export function applyTemplate(meta = {}, templateId) {
  const tpl = pickTemplate(templateId || meta.templateId);
  const out = { ...meta, templateId: tpl.id };
  const defs = tpl.defaults || {};

  if (tpl.ministry && !out.ministry) out.ministry = tpl.ministry;
  if (tpl.university && !out.university) out.university = tpl.university;
  if (defs.faculty && !out.faculty) out.faculty = defs.faculty;
  if (defs.department && !out.department) out.department = defs.department;
  if ((defs.city || tpl.defaults?.city) && !out.city) out.city = defs.city || tpl.defaults?.city;
  if (!out.year) out.year = String(new Date().getFullYear());

  return out;
}

/**
 * Полная meta для титульного листа, экспорта и сохранения документа.
 * @param {object} rawMeta
 * @param {{ workType?: string, outline?: object, cfg?: object, topic?: string }} ctx
 */
export function resolveDocumentMeta(rawMeta = {}, ctx = {}) {
  const { workType, outline, cfg, topic } = ctx;
  const templateId = rawMeta.templateId || DEFAULT_TEMPLATE_ID;
  const meta = applyTemplate({ ...rawMeta }, templateId);

  meta.title = cleanText(meta.title || outline?.title || topic || '');
  meta.year = meta.year || String(new Date().getFullYear());
  meta.city = meta.city || 'Москва';
  meta.ministry = meta.ministry || pickTemplate(templateId).ministry;

  if (!meta.university && pickTemplate(templateId).university) {
    meta.university = pickTemplate(templateId).university;
  }

  meta.workLabel = getWorkLabel(meta, cfg, workType);
  return meta;
}

export function listTemplates() {
  return Object.values(UNIVERSITY_TEMPLATES).map((t) => ({
    id: t.id,
    label: t.label,
    university: t.university || '',
    city: t.defaults?.city || 'Москва',
    faculty: t.defaults?.faculty || '',
    department: t.defaults?.department || '',
    placeholders: t.placeholders || {},
    isDefault: t.id === DEFAULT_TEMPLATE_ID,
  }));
}

export function getWorkLabel(meta, cfg, workType) {
  const wt = workType || cfg?.workType;
  const tpl = pickTemplate(meta?.templateId);
  if (wt && tpl.workLabels?.[wt]) return tpl.workLabels[wt];
  if (tpl.workLabel) return tpl.workLabel;
  if (wt && WORK_TYPE_LABELS[wt]) return WORK_TYPE_LABELS[wt];
  if (cfg?.label) return String(cfg.label).toUpperCase();
  return WORK_TYPE_LABELS.vkr;
}

export function getTemplatePlaceholders(templateId) {
  return pickTemplate(templateId).placeholders || {};
}
