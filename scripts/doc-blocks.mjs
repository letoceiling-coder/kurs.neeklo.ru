/**
 * Точечные операции с блоками документа.
 * Usage:
 *   node scripts/doc-blocks.mjs summary <docId>
 *   node scripts/doc-blocks.mjs find <docId> --kind p --pattern "актуальн"
 *   node scripts/doc-blocks.mjs get <docId> <index>
 *   node scripts/doc-blocks.mjs fix-leaks <docId>
 */
import 'dotenv/config';
import { getDocument, updateDocument } from '../src/store.js';
import { htmlToBlocks } from '../src/htmlToBlocks.js';
import { blocksToHtml } from '../src/blocksToHtml.js';
import {
  summarizeBlocks, findBlocks, getBlock, stripMarkdownTableLeaksInBlocks,
} from '../src/blockTools.js';
import { auditVkrDocument } from '../src/vkrAudit.js';

function loadBlocks(docId) {
  const doc = getDocument(docId);
  if (!doc) throw new Error(`Документ не найден: ${docId}`);
  return { doc, blocks: htmlToBlocks(doc.html || '') };
}

function main() {
  const [cmd, docId, arg] = process.argv.slice(2);
  if (!cmd || !docId) {
    console.log('Usage: doc-blocks.mjs <summary|find|get|fix-leaks> <docId> [index]');
    process.exit(1);
  }

  const { doc, blocks } = loadBlocks(docId);

  if (cmd === 'summary') {
    console.log(JSON.stringify({ id: doc.id, title: doc.title, ...summarizeBlocks(blocks) }, null, 2));
    return;
  }

  if (cmd === 'find') {
    const kind = process.argv.includes('--kind') ? process.argv[process.argv.indexOf('--kind') + 1] : null;
    const pattern = process.argv.includes('--pattern') ? process.argv[process.argv.indexOf('--pattern') + 1] : null;
    console.log(JSON.stringify(findBlocks(blocks, { kind, pattern }), null, 2));
    return;
  }

  if (cmd === 'get') {
    console.log(JSON.stringify(getBlock(blocks, Number(arg)), null, 2));
    return;
  }

  if (cmd === 'fix-leaks') {
    const fixed = stripMarkdownTableLeaksInBlocks(blocks);
    const audit = auditVkrDocument({
      blocks: fixed,
      outline: doc.outline || {},
      research: { domain: 'pedagogy' },
      cfg: { minRefs: 40, minTables: 3 },
      sources: doc.sources || {},
    });
    updateDocument(docId, { html: blocksToHtml(fixed) });
    console.log(JSON.stringify({
      id: docId,
      tableLeaksBefore: summarizeBlocks(blocks).tableLeaks,
      tableLeaksAfter: summarizeBlocks(fixed).tableLeaks,
      auditPass: audit.pass,
      issues: audit.issues,
    }, null, 2));
    process.exit(audit.pass ? 0 : 1);
  }

  console.error('Unknown command:', cmd);
  process.exit(1);
}

main();
