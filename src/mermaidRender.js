import puppeteer from 'puppeteer';

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

/** Убрать markdown-обёртки и лишние пробелы из кода Mermaid. */
export function cleanMermaidCode(raw) {
  let code = String(raw || '').trim();
  code = code.replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return code;
}

async function renderViaMermaidInk(code) {
  const encoded = Buffer.from(code, 'utf8').toString('base64url');
  const url = `https://mermaid.ink/img/${encoded}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`mermaid.ink HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error('mermaid.ink empty response');
    return `data:image/png;base64,${buf.toString('base64')}`;
  } finally {
    clearTimeout(t);
  }
}

async function renderViaPuppeteer(code) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(`<!DOCTYPE html><html><head>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>body{margin:0;padding:16px;background:#fff}#d{display:inline-block}</style>
</head><body><pre id="d" class="mermaid"></pre></body></html>`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate((c) => { document.getElementById('d').textContent = c; }, code);
    await page.evaluate(async () => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
      await mermaid.run({ nodes: [document.getElementById('d')] });
    });
    await page.waitForSelector('svg', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const el = await page.$('#d svg') || await page.$('#d');
    const png = await el.screenshot({ type: 'png', omitBackground: false });
    return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  } finally {
    await page.close();
  }
}

/**
 * Mermaid → PNG data URL (mermaid.ink, fallback puppeteer).
 * @returns {Promise<string>} data:image/png;base64,...
 */
export async function renderMermaidPng(mermaidCode) {
  const code = cleanMermaidCode(mermaidCode);
  if (!code) throw new Error('empty mermaid code');
  try {
    return await renderViaMermaidInk(code);
  } catch (e) {
    console.warn('[mermaid] ink failed:', e.message);
    return renderViaPuppeteer(code);
  }
}
