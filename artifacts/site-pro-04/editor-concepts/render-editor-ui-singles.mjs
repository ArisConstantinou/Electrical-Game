import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 6000 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  for (let concept = 1; concept <= 5; concept++) {
    await page.goto(new URL(`./editor-flow-v2.html?c=${concept}`, import.meta.url).href);
    const frames = await page.locator('.screen').count();
    const states = concept === 4
      ? { nav: 1, build: 1, place: 2, edit: 3, view: 4 }
      : { nav: 1, build: 2, place: 3, edit: 4, view: 5 };
    for (const [name, index] of Object.entries(states)) {
      if (index >= frames) throw new Error(`Missing ${name} frame in concept ${concept}`);
      const filename = `editor-ui-0${concept}-${name}.jpg`;
      await page.screenshot({
        path: fileURLToPath(new URL(`./${filename}`, import.meta.url)),
        type: 'jpeg', quality: 90,
        clip: { x: 0, y: index * 874, width: 390, height: 874 },
      });
      console.log(`${filename}: screen ${index + 1}`);
    }
  }
} finally { await browser.close(); }
