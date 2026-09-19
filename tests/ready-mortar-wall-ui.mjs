import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv.find(arg=>/^https?:/.test(arg))??'http://127.0.0.1:5362/Electrical-Game/';
const repro=process.argv.includes('--repro'),out='output/ready-mortar-wall';
await mkdir(out,{recursive:true});
const report={repro,cases:[],errors:[],fixtures:'Recipe ingredients, camera, deterministic clock and cavity impacts; real mouse/touch tool selection and casts. No FINISH click.'};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing);await page.locator('#start-button')[mobile?'tap':'click']();
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.__readyStep=g.step.bind(g);g.step=()=>{};const m=g.mixing,b=m.batch;b.addWater(20/3);b.openSack(0);for(let i=0;i<6;i++){b.scoopCement(0);b.pour('trowel');}for(let i=0;i<12;i++){b.scoopSand();b.pour('shovel');}b.mix(8);m.setActive(true);});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__readyStep(1/60);},n);
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{mixing:g.mixing.telemetry,mortar:g.mortar.telemetry,fieldMass:g.mortar.field.mass,finish:!document.querySelector('#mixing-finish').hidden,overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError};});
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.85);c.lookAt(0,1.4,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step(2);
 if(mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');await step(30);
 const before=await state();assert(before.mixing.batch.ready&&!before.mixing.finished,'Ready batch reproduces unconfirmed FINISH state');assert.equal(before.mixing.active,false);
 const cdp=mobile?await context.newCDPSession(page):null;
 const cast=async()=>{if(mobile){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:71,x:b.x+b.width/2,y:b.y+b.height/2}]});}else await page.mouse.down();await step(28);if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();await step(100);};
 await cast();const intact=await state();
 if(!repro){assert(intact.mortar.stuckKg>0,'Ready unconfirmed batch sticks to intact wall');assert.equal(intact.mixing.finished,true);assert.equal(intact.finish,false);assert(Math.abs(intact.mortar.launchedKg-.65)<1e-7);}
 await page.evaluate(async()=>{const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume;for(let pass=0;pass<10;pass++)for(let x=.3;x<.61;x+=.014)for(let y=1.29;y<1.52;y+=.014){const h=v.raycast({x,y,z:v.frontZ+.08},{x:0,y:0,z:-1},.3);if(h&&v.frontZ-h.point.z<.066)v.impact({point:h.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:18});}w.flushGeometry();await w.waitForGeometry();const c=g.renderer.camera;c.position.x=.45;c.lookAt(.45,1.4,v.frontZ-.05);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step(30);
 const loads=[];for(let i=0;i<4;i++){await cast();loads.push(await state());}
 const after=loads.at(-1);if(!repro){assert(after.fieldMass>intact.fieldMass+.3,'Repeated casts accumulate in real chased cavity');assert(Math.abs(after.mortar.launchedKg-3.25)<1e-7);assert(Math.abs(before.mixing.batch.massKg-after.mixing.batch.massKg-3.25)<1e-7,'Only released finite scoops consumed');assert.equal(after.overflow,false);assert.equal(after.renderError,'');}
 await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${repro?'before':'after'}.png`});
 if(!repro){
  await page.evaluate(()=>window.__wireTheHouse.mixing.batch.addWater(.1));await step(2);
  const remix=await state();assert.equal(remix.mixing.batch.ready,false);await cast();
  const rejected=await state();assert.equal(rejected.mortar.launchedKg,after.mortar.launchedKg,'Adding an ingredient requires real remixing before another cast');assert.equal(rejected.mixing.batch.massKg,remix.mixing.batch.massKg);
  await page.evaluate(()=>window.__wireTheHouse.mixing.batch.discard());await cast();assert.equal((await state()).mortar.launchedKg,after.mortar.launchedKg,'Empty batch cannot provide mortar');
 }
 report.cases.push({mobile,before,intact,loads});await context.close();
}assert.deepEqual(report.errors,[]);}finally{await writeFile(`${out}/${repro?'repro':'report'}.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({repro,cases:report.cases.map(c=>({mobile:c.mobile,launched:c.loads.at(-1).mortar.launchedKg,stuck:c.loads.at(-1).mortar.stuckKg}))}));
