import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

await mkdir('output/editor-flow-v2',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(let n=1;n<=5;n++){
    await page.goto(new URL(`./editor-flow-v2.html?c=${n}`,import.meta.url).href);
    await page.locator('.world').first().evaluate(async element=>{const url=getComputedStyle(element).backgroundImage.slice(5,-2);const image=new Image();image.src=url;await image.decode();});
    const states=n===3?['canvas','wheel','assets','place','edit','view']:n===4?['canvas','assets','place','edit','view']:['canvas','open','assets','place','edit','view'];
    if(await page.locator('.screen').count()!==states.length)throw new Error(`Concept ${n}: expected ${states.length} workflow states`);
    if(await page.evaluate(()=>document.documentElement.scrollWidth>390))throw new Error(`Concept ${n}: overflow`);
    if(errors.length)throw new Error(`Concept ${n}: ${errors.join('; ')}`);
    await page.screenshot({path:fileURLToPath(new URL(`./editor-flow-v2-0${n}.png`,import.meta.url)),fullPage:true});
    for(let state=0;state<states.length;state++)await page.locator('.screen').nth(state).screenshot({path:`output/editor-flow-v2/0${n}-${states[state]}.png`});
    console.log(`Concept ${n}: ${states.join(', ')}`);
  }
}finally{await browser.close();}
