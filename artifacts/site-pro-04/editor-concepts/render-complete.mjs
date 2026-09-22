import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 1688 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(let concept=1;concept<=5;concept++){
    await page.goto(new URL(`./editor-ui-complete.html?c=${concept}`, import.meta.url).href);
    await page.locator('.scene').first().evaluate(async element=>{
      const url=getComputedStyle(element).backgroundImage.slice(5,-2);
      const image=new Image();image.src=url;await image.decode();
    });
    if(await page.locator('.screen').count()!==2)throw new Error(`Concept ${concept}: missing UI state`);
    if(await page.evaluate(()=>document.documentElement.scrollWidth>390))throw new Error(`Concept ${concept}: horizontal overflow`);
    if(errors.length)throw new Error(`Concept ${concept}: ${errors.join('; ')}`);
    const path=fileURLToPath(new URL(`./editor-ui-full-0${concept}.png`,import.meta.url));
    await page.screenshot({path,fullPage:true});
    console.log(`Full UI concept 0${concept}: 390×1688 CSS pixels, @2x PNG`);
  }
}finally{await browser.close();}
