import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import path from 'node:path';
const root=path.resolve('C:/Users/arz0r/.codex/worktrees/visual-review-publication/Electrical-Game/public');
const url=process.env.REVIEW_URL??'http://127.0.0.1:5365/Electrical-Game/review/2026-09-26/';
const out='output/visual-review-publication';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:1000}]){
 const context=await browser.newContext({viewport,isMobile:viewport.width<1000,hasTouch:viewport.width<1000,reducedMotion:'reduce'});
 if(!process.env.REVIEW_URL){await routeBuildingDist(context,root);await context.route(url,async r=>r.fulfill({body:await readFile(root+'/review/2026-09-26/index.html'),contentType:'text/html'}));}
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#jump').scrollIntoViewIfNeeded();await page.locator('#arms').scrollIntoViewIfNeeded();
 // Force all previews to decode, including images outside the initial viewport.
 const results=await page.evaluate(async()=>{const images=[...document.images];for(const i of images)i.loading='eager';await Promise.all(images.map(i=>i.decode()));return {loaded:images.filter(i=>i.naturalWidth>0).length,total:images.length,overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.equal(results.loaded,18);assert.equal(results.overflow,false);assert.deepEqual(errors,[]);
 const original=await page.evaluate(async()=>{const r=await fetch(document.querySelector('a.photo').href);return {status:r.status,type:r.headers.get('content-type'),bytes:(await r.arrayBuffer()).byteLength};});assert.equal(original.status,200);assert.match(original.type,/image\/png/);assert(original.bytes>10000);
 await page.locator('nav a[href="#poses"]').click();await page.waitForTimeout(300);assert.equal(new URL(page.url()).hash,'#poses');
 await page.screenshot({path:`${out}/${process.env.REVIEW_URL?'live':'local'}-${viewport.width}.png`});
 report.push({viewport,...results,originalStatus:original.status,errors});await context.close();
}}finally{await browser.close();await writeFile(`${out}/${process.env.REVIEW_URL?'live':'local'}-report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
