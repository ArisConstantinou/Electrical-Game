import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const b=await chromium.launch({channel:'chrome',headless:true});
try{const c=await b.newContext({viewport:{width:1440,height:810}});await blockPointerLock(c);const p=await c.newPage();await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await p.locator('#start-button').click();await p.waitForTimeout(800);await mkdir('output/model-inspector',{recursive:true});await p.keyboard.press('c');await p.waitForTimeout(100);await p.screenshot({path:'output/model-inspector/before-c.png'});console.log({modelPanelButtons:await p.locator('#model-inspector-open').count(),view:JSON.parse(await p.evaluate(()=>window.render_game_to_text())).view});}finally{await b.close();}
