import { chatJSON } from './openrouter.js';
import { aiTopicSystemExtra } from './researchContext.js';
import { sanitizeAcademicText } from './dataIntegrity.js';
import { cleanText } from './textutil.js';
import { renderMermaidPng } from './mermaidRender.js';

function systemPrompt(research) {
  let s = 'Ты генерируешь Mermaid-диаграммы для приложений ВКР (BPMN, UML, ER). Возвращай только валидный JSON.';
  if (research?.integrityBlock) s += `\n${research.integrityBlock}`;
  if (research?.aiTopic) s += aiTopicSystemExtra();
  return s;
}

function contextPrompt(research) {
  if (!research) return '';
  const parts = [];
  if (research.companyBlock) parts.push(`\n--- КАРТОЧКА ПРЕДПРИЯТИЯ ---\n${research.companyBlock}`);
  if (research.sourceBlock) parts.push(`\n--- ИСТОЧНИКИ ---\n${research.sourceBlock}`);
  return parts.join('\n');
}

const DEFAULT_DIAGRAMS = [
  {
    appendix: 'А',
    title: 'ПРИЛОЖЕНИЕ А — BPMN процесса подготовки документов',
    caption: 'BPMN процесса «as-is» (ручная подготовка документов)',
    mermaid: `flowchart TD
  A[Запрос документа] --> B[Сбор исходных данных]
  B --> C[Подготовка черновика]
  C --> D[Согласование экспертом]
  D --> E[Утверждение]`,
    description: 'Схема отражает текущий процесс подготовки документов без автоматизации.',
  },
  {
    appendix: 'Б',
    title: 'ПРИЛОЖЕНИЕ Б — UML Sequence Diagram',
    caption: 'UML Sequence Diagram генерации документа',
    mermaid: `sequenceDiagram
  participant U as Пользователь
  participant S as Система
  participant AI as AI Orchestrator
  participant DB as База данных
  U->>S: Запрос генерации
  S->>AI: Формирование промпта
  AI->>DB: Поиск в Knowledge Base
  DB-->>AI: Контекст RAG
  AI-->>S: Текст документа
  S-->>U: Результат`,
    description: 'Диаграмма последовательности взаимодействия при генерации документа.',
  },
  {
    appendix: 'В',
    title: 'ПРИЛОЖЕНИЕ В — ER-модель базы данных',
    caption: 'ER-диаграмма базы данных системы',
    mermaid: `erDiagram
  USERS ||--o{ DOCUMENTS : creates
  USERS ||--o{ CASES : owns
  CASES ||--o{ DOCUMENTS : contains
  DOCUMENTS ||--o{ GENERATION_HISTORY : logs
  TEMPLATES ||--o{ DOCUMENTS : uses
  KNOWLEDGE_BASE ||--o{ EMBEDDINGS : stores
  DOCUMENTS }o--|| TEMPLATES : based_on`,
    description: 'ER-модель включает сущности Users, Cases, Documents, Templates, KnowledgeBase, Embeddings, GenerationHistory.',
  },
];

async function generateDiagramSpecs(outline, research) {
  const prompt = `Работа на тему "${outline.title}".
Сформируй 3 приложения с Mermaid-диаграммами для ВКР по теме ИИ/автоматизации документов.

Верни СТРОГО JSON-массив из 3 объектов:
[
  {
    "appendix": "А",
    "title": "ПРИЛОЖЕНИЕ А — ...",
    "caption": "краткое название рисунка для подписи",
    "mermaid": "flowchart TD\\n  A[...] --> B[...]",
    "description": "1–2 предложения пояснения"
  },
  ...
]

Требования:
1) ПРИЛОЖЕНИЕ А — BPMN/flowchart процесса «as-is» (ручная подготовка).
2) ПРИЛОЖЕНИЕ Б — sequenceDiagram (пользователь → система → AI → БД).
3) ПРИЛОЖЕНИЕ В — erDiagram (Users, Cases, Documents, Templates, KnowledgeBase, Embeddings, GenerationHistory).

Код mermaid — валидный синтаксис Mermaid 11, без markdown-обёрток, переносы через \\n.
${contextPrompt(research)}`;

  try {
    const arr = await chatJSON([
      { role: 'system', content: systemPrompt(research) },
      { role: 'user', content: prompt },
    ], { max_tokens: 4000, temperature: 0.35, jsonMode: true });
    if (Array.isArray(arr) && arr.length >= 2) {
      return arr.slice(0, 3).map((item) => ({
        appendix: cleanText(item.appendix || ''),
        title: cleanText(item.title || '').toUpperCase(),
        caption: cleanText(item.caption || ''),
        mermaid: cleanMermaidFromAi(item.mermaid),
        description: cleanText(item.description || ''),
      })).filter((x) => x.mermaid);
    }
  } catch (e) {
    console.warn('[appendix] AI diagrams failed:', e.message);
  }
  return DEFAULT_DIAGRAMS;
}

function cleanMermaidFromAi(raw) {
  return String(raw || '')
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/\\n/g, '\n')
    .trim();
}

/**
 * Приложения с Mermaid-диаграммами → PNG.
 * @returns {Promise<object[]>} blocks (h2, p, figure)
 */
export async function buildAppendixBlocks(outline, research, onProgress = () => {}) {
  onProgress('Генерирую Mermaid-диаграммы для приложений…');
  const specs = await generateDiagramSpecs(outline, research);
  const blocks = [];

  for (const item of specs) {
    const title = item.title || `ПРИЛОЖЕНИЕ ${item.appendix}`;
    blocks.push({ kind: 'h2', text: title });
    if (item.description) {
      blocks.push({ kind: 'p', text: sanitizeAcademicText(item.description, research) });
    }
    onProgress(`Рендерю ${title}…`);
    try {
      const src = await renderMermaidPng(item.mermaid);
      blocks.push({
        kind: 'figure',
        caption: item.caption || title,
        src,
        mermaid: item.mermaid,
      });
      console.log(`[appendix] rendered ${item.appendix}: ${item.caption}`);
    } catch (e) {
      console.warn(`[appendix] render ${item.appendix} failed:`, e.message);
      blocks.push({
        kind: 'p',
        text: `Диаграмма «${item.caption}» (см. описание выше).`,
      });
    }
  }

  return blocks;
}
