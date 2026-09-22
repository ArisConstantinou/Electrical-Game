import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve('artifacts/site-pro-04/mansion-concept');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  for (const name of ['ground-floor', 'building-section', 'electrical-workroom']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: name === 'ground-floor' ? 1400 : name === 'building-section' ? 1450 : 1320 }, deviceScaleFactor: 1 });
    const svg = await readFile(join(root, `${name}.svg`), 'utf8');
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: join(root, `${name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
