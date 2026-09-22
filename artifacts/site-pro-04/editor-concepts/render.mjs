import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', error => { throw error; });
  const source = new URL('./concepts.html', import.meta.url);
  for (let concept = 1; concept <= 5; concept++) for (const mode of ['3d', '2d']) {
    await page.goto(`${source.href}?c=${concept}&mode=${mode}`);
    if (await page.locator('.screen').count() !== 1) throw new Error(`Concept ${concept} ${mode} did not render`);
    await page.screenshot({ path: fileURLToPath(new URL(`./concept-0${concept}-${mode}.png`, import.meta.url)) });
    console.log(`Concept ${concept} ${mode}: 390×844 CSS pixels, @2x PNG`);
  }
  for (let concept = 1; concept <= 5; concept++) {
    await page.goto(`${source.href}?c=${concept}&mode=3d&floors=open`);
    if (await page.locator('.floor-pop').count() !== 1) throw new Error(`Concept ${concept} floor viewer did not render`);
    await page.screenshot({ path: fileURLToPath(new URL(`./concept-0${concept}-floors.png`, import.meta.url)) });
  }
  await page.goto(`${source.href}?c=3&mode=2d&floors=open`);
  if (await page.locator('.floor-pop').count() !== 1) throw new Error('Top-view floor selector did not render');
  await page.screenshot({ path: fileURLToPath(new URL('./concept-03-2d-floors.png', import.meta.url)) });
} finally { await browser.close(); }
