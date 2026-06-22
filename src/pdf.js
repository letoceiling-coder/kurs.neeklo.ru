import puppeteer from 'puppeteer';
import { buildFullHtml } from './fullDocument.js';
import { htmlToBlocks } from './htmlToBlocks.js';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
    });
  }
  return browserPromise;
}

/**
 * Генерация PDF из HTML редактора или блоков.
 */
export async function buildPdf({ html, meta, cfg, outline, blocks, workType }) {
  const plainLen = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  const bodyHtml = plainLen >= 40 ? html : null;
  const blockList = blocks || (bodyHtml ? htmlToBlocks(bodyHtml) : html ? htmlToBlocks(html) : []);
  const fullHtml = buildFullHtml({ meta, cfg, outline, blocks: blockList, bodyHtml: bodyHtml || undefined, workType });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 60000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '30mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width:100%;font-size:10pt;text-align:center;font-family:'Times New Roman',serif;color:#333;">
          <span class="pageNumber"></span>
        </div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Закрыть браузер при завершении процесса */
export async function closePdfBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

process.on('exit', () => { closePdfBrowser().catch(() => {}); });
