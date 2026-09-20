import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
const url=process.argv.find(arg=>/^https?:/.test(arg))??'http://127.0.0.1:5365/Electrical-Game/';
const out='output/perfect-mortar-native';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await blockPointerLock(page.context());
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);
 await page.locator('#start-button')[mobile?'tap':'click']();await page.evaluate(()=>{document.exitPointerLock();const g=window.__wireTheHouse;window.__perfectStep=g.step.bind(g);g.step=()=>{};});
 await prepareFinishedMortar(page);
 if(mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');
 const loads=[];for(const x of [.25,.7,1.15]){
 await page.evaluate(x=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.85);c.lookAt(x,1.45,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;for(let i=0;i<60;i++)window.__perfectStep(1/60);},x);
 const cdp=mobile?await page.context().newCDPSession(page):null;
 if(cdp){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:21}]});}else await page.keyboard.down('KeyE');
 await page.evaluate(()=>{for(let i=0;i<28;i++)window.__perfectStep(1/60);});
 const phase=await page.evaluate(()=>window.__wireTheHouse.mortar.throwFeedback.phase);assert(phase>=.42&&phase<=.58);
 if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyE');
 await page.evaluate(()=>{for(let i=0;i<600;i++)window.__perfectStep(1/60);});
 const state=await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.render();return{...g.mortar.telemetry,settledMeshes:g.mortar.settled.length,overflow:document.documentElement.scrollWidth>innerWidth};});
 assert(state.stuckKg>state.launchedKg-1e-6,`${mobile?'mobile':'desktop'}: correct dry wall cast retained only ${state.stuckKg}`);
 assert(state.floorKg<1e-6,'PERFECT cast still rejects cohesive mortar');assert.equal(state.settledMeshes,0,'PERFECT cast creates a visible floor clod');assert(Math.abs(state.launchedKg-state.stuckKg-state.floorKg-state.restingKg-state.movingKg)<1e-6);assert(!state.overflow);assert.deepEqual(errors,[]);
 await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}.png`});loads.push({x,phase,state,errors});}
 await page.evaluate(async()=>{const g=window.__wireTheHouse,c=g.renderer.camera;await g.mortar.waitForGeometry();c.lookAt(.7,.2,g.room.brickWall.volume.frontZ);g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-floor.png`});report.push({mobile,url,loads});await page.close();
}}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
