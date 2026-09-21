import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out=process.env.ARM_REVIEW_OUT??'output/pvc-forearm-review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto((process.env.GAME_URL??'http://127.0.0.1:5365/Electrical-Game/')+'?renderer=webgl');await page.locator('#start-button').click({timeout:120000});
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.tick=g.step.bind(g);g.step=()=>{};g.mixing.setActive(false);const c=g.renderer.camera;c.position.set(2.2,1.65,.44);c.lookAt(2.2,.75,-1.56);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.pvc.transition('bending');g.pvc.insertion=1;g.pvc.setFocus();for(let i=0;i<100;i++)window.tick(1/60,0,false);});
 for(let cell=0;cell<10;cell++){
  const angle=(cell+1)*9;
  const state=await page.evaluate(async cell=>{const g=window.__wireTheHouse,p=g.pvc,w=g.workerBody;p.bend.grip=cell;for(let i=0;i<30;i++){p.bend.press(1/60);window.tick(1/60,0,false);}g.renderer.render();await g.renderer.waitForFrame();return{body:w.telemetry,thumbRise:w.point('thumb.03.R').y-w.point('thumb.01.R').y,points:Object.fromEntries(['L','R'].map(s=>[s,['upper_arm','forearm','hand'].map(n=>w.point(n+'.'+s).toArray())]))};},cell);
  for(const side of ['L','R']){const [shoulder,elbow,wrist]=state.points[side];assert(elbow[1]<shoulder[1]+.03,'Elbow must not lift above the shoulder');assert(state.body.gripReachErrors[side]<.008);assert(state.body.fingerFit['pipeWrist'+side].bendDegrees<5);if(side==='R')assert(elbow[0]>shoulder[0]-.03,'Right elbow must not cross the torso');}
  if(cell===4||cell===9)await page.screenshot({path:`${out}/final-${angle}.png`});report.cases.push({angle,...state});
 }
 assert(report.cases.at(-1).thumbRise>0,'Thumb up in the reference 90 degree grip');
 await page.evaluate(async()=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera.clone(),mid=w.point('forearm.R').lerp(w.point('hand.R'),.5);c.position.copy(mid).add(c.position.clone().set(.48,.12,-.30));c.lookAt(mid);g.renderer.viewCamera=c;g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:`${out}/right-arm-side.png`});assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/review.json`,JSON.stringify(report,null,2));}
console.log({passed:true,cases:report.cases.length,errors:report.errors});
