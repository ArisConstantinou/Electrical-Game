import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const before=process.argv.includes('--before'),out=`output/mobile-workspace/${before?'before':'after'}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={before,cases:[],errors:[]};
try{for(const [name,viewport,mobile]of [['portrait',{width:390,height:680},true],['landscape',{width:844,height:390},true],['desktop',{width:1366,height:900},false]]){
 const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.routeWebSocket('**',()=>{});
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#start-button').click({timeout:120000});await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.tick=g.step.bind(g);g.step=()=>{};g.mixing.setActive(false);});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.tick(1/60,0,false);},n??3);
 const snap=async label=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.9,1.65,.75);c.lookAt(3.58,1.25,1.15);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step();await snap('stock');
 const stock=await page.evaluate(()=>!!window.__wireTheHouse.pvc.stock.userData.stockLabel);
 await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.transition('bending');p.setFocus();});await step(100);await snap('bend');
 const body=await page.evaluate(()=>window.__wireTheHouse.workerBody.telemetry);
 const mesh=await page.evaluate(()=>{const g=window.__wireTheHouse,a=[];g.workerBody.traverse(o=>{if(o.isMesh)a.push({name:o.name,vertices:o.geometry.attributes.position.count});});return a;});
 const hints=await page.locator('#pvc-prompt').textContent();
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.pvc.pause();g.pvc.transition('sealed');});await step();
 await page.evaluate(()=>window.__wireTheHouse.selectTool('fitting'));await step();await page.locator('#box-assembly-toggle').click();await step(30);await snap('boxes');
 const boxRect=await page.locator('#box-supply').boundingBox();
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.setBoxAssemblyActive(false);const root=g.mixing.wheelbarrow.model.group;g.renderer.camera.position.copy(root.localToWorld(g.renderer.camera.position.clone().set(0,1.65,-1.1)));g.player.yaw=root.rotation.y+Math.PI;g.player.pitch=-.6;});await step();
 if(mobile)await page.locator('#mobile-interact').tap();else await page.keyboard.press('KeyE');await step(90);await snap('cart');
 const cartRect=await page.locator('#wheelbarrow-guide').boundingBox();
 report.cases.push({name,body,mesh,hints,stock,boxRect,cartRect});
 if(!before){assert(!stock);assert(body.visible);assert.deepEqual(report.errors,[]);if(mobile){assert(!/\b(LMB|ESC|RMB|Mouse|A \/ D)\b/.test(hints));assert(cartRect.height<95);assert(boxRect.height<160);}}
 await context.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}console.log({cases:report.cases.length,errors:report.errors});
