import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const before=process.argv.includes('--before'),out=`output/worker-eye-transition/${before?'before':'after'}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:900}});await blockPointerLock(context);const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded);await page.waitForTimeout(1200);
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=()=>{};g.selectTool('spray');g.player.pitch=-1.18;g.player.yaw=0;g.renderer.camera.rotation.set(-1.18,0,0);g.renderer.camera.position.set(.7,.95,-.5);});
 for(const height of [.68,.95,1.10,1.30,1.65]){
  const result=await page.evaluate(async height=>{const g=window.__wireTheHouse,c=g.renderer.camera,w=g.workerBody;c.position.y=height;g.player.crouched=false;w.bend=0;g.fpsRig.update(1/60,false,false);g.fpsRig.poseArms(c);w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);g.renderer.render();await g.renderer.waitForFrame();return{height,bend:w.bend,neck:w.point('neck').toArray(),chest:w.point('chest').toArray(),head:w.point('head').toArray()};},height);
  report.cases.push(result);await page.screenshot({path:`${out}/eye-${height}.png`});
 }
 assert.deepEqual(report.errors,[]);
 if(!before)for(const c of report.cases)assert(c.neck[1]<c.height+.12,`Torso enters the eye during height transition: ${JSON.stringify(c)}`);
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}console.log(report);
