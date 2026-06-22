/**
 * ЭТАП 2: Пост-валидация готового DOCX.
 * Повторно «открывает» сгенерированный буфер (DOCX = zip с XML),
 * анализирует реальные таблицы внутри document.xml и сверяет со структурой блоков.
 */
import JSZip from 'jszip';

/** Извлечь word/document.xml из буфера DOCX. */
async function extractDocumentXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml не найден в DOCX');
  return file.async('string');
}

/** Подсчитать реальные таблицы и их параметры в XML. */
function analyzeXmlTables(xml) {
  const tables = [];
  const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let m;
  while ((m = tblRe.exec(xml)) !== null) {
    const tbl = m[0];
    const rows = (tbl.match(/<w:tr\b/g) || []).length;
    const gridCols = (tbl.match(/<w:gridCol\b/g) || []).length;
    const hasFixedLayout = /<w:tblLayout\s+w:type="fixed"/.test(tbl)
      || /w:type="fixed"/.test(tbl);
    tables.push({ rows, gridCols, hasFixedLayout });
  }
  return tables;
}

/**
 * Полная пост-проверка DOCX-буфера.
 * @param {Buffer} buffer — результат buildDocx
 * @param {Array} blocks — исходные блоки (для сверки числа таблиц)
 */
export async function validateDocxBuffer(buffer, blocks = []) {
  const errors = [];
  const warnings = [];

  if (!buffer || buffer.length < 2000) {
    errors.push('DOCX пустой или повреждён (размер < 2KB)');
    return { ok: false, errors, warnings, tables: [] };
  }

  let xml;
  try {
    xml = await extractDocumentXml(buffer);
  } catch (e) {
    errors.push(`Не удалось открыть DOCX: ${e.message}`);
    return { ok: false, errors, warnings, tables: [] };
  }

  const xmlTables = analyzeXmlTables(xml);
  const expectedTables = blocks.filter((b) => b.kind === 'table').length;

  // 1. Число таблиц совпадает
  if (xmlTables.length !== expectedTables) {
    errors.push(`Таблиц в DOCX: ${xmlTables.length}, ожидалось ${expectedTables}`);
  }

  // 2. Каждая таблица: фикс. раскладка, ≥2 строк, ≥2 колонок
  xmlTables.forEach((t, i) => {
    if (!t.hasFixedLayout) {
      warnings.push(`Таблица ${i + 1}: нет фиксированной раскладки (риск схлопывания колонок)`);
    }
    if (t.rows < 2) errors.push(`Таблица ${i + 1}: ${t.rows} строк (мин 2)`);
    if (t.gridCols < 2) errors.push(`Таблица ${i + 1}: ${t.gridCols} колонок (мин 2)`);
  });

  // 3. Нет псевдотаблиц (markdown |...|) в тексте документа
  const pipeRuns = (xml.match(/<w:t[^>]*>[^<]*\|[^<]*\|[^<]*\|[^<]*<\/w:t>/g) || []).length;
  if (pipeRuns > 0) {
    errors.push(`В тексте DOCX найдено ${pipeRuns} псевдотаблиц через | (запрещено)`);
  }

  // 4. Нет служебных артефактов
  if (/КОНЕЦ ТАБЛИЦЫ/i.test(xml)) {
    errors.push('В DOCX остался служебный маркер «КОНЕЦ ТАБЛИЦЫ»');
  }

  // 5. Ключевые разделы присутствуют
  for (const section of ['ВВЕДЕНИЕ', 'ЗАКЛЮЧЕНИЕ', 'СПИСОК']) {
    if (!xml.includes(section)) {
      warnings.push(`В DOCX не найден маркер раздела «${section}»`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    tables: xmlTables,
    stats: { tablesInDocx: xmlTables.length, expectedTables },
  };
}
