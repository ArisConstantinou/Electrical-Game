import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/mixing-stand-up';await mkdir(out,{recursive:true});
const report={cases:[],errors:[],fixtures:'Camera/recipe and deterministic clock; native keyboard/touch stance and tool controls.'};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const layout of [{name:'desktop',width:1366,height:768},{name:'portrait',width:390,height:844},{name:'landscape',width:844,height:390}]){
 const mobile=layout.name!=='desktop',context=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse?.mixing);await page.locator('#start-button')[mobile?'tap':'click']();await page.waitForTimeout(350);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.__stanceStep=g.step.bind(g);g.step=()=>{};});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__stanceStep(1/60);},n);
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{crouched:g.player.crouched,y:g.renderer.camera.position.y,mixing:g.mixing.telemetry,held:g.input.actionHeld,overflow:document.documentElement.scrollWidth>innerWidth,error:g.renderer.renderError};});
 const click=async s=>{await page.locator(s)[mobile?'tap':'click']();await step(2);};
 const setup=async()=>{await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera;m.setActive(false);g.player.crouched=false;const b=m.models.bucket.getWorldPosition(c.position.clone());c.position.set(b.x,1.65,b.z-.98);c.lookAt(b.x,b.y+.3,b.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;m.tool='hands';});await step(2);await click('[data-mix-equip="mixer"]');};
 const interact=async()=>{if(mobile)await click('#mobile-interact');else{await page.keyboard.press('KeyE');await step(2);}};
 const stand=async()=>{if(mobile)await click('#mixing-stance');else{await page.keyboard.press('KeyV');await step(2);}await step(100);};
 await setup();await interact();await step(6);assert((await state()).mixing.approaching);await stand();const interrupted=await state();assert(!interrupted.crouched&&!interrupted.mixing.approaching&&!interrupted.mixing.inserted);assert(interrupted.y>1.64,'Manual stand cancels the approach and restores standing');
 await setup();await interact();await step(90);assert((await state()).mixing.inserted);await stand();const manual=await state();assert(!manual.crouched&&!manual.mixing.inserted&&!manual.mixing.mixing&&!manual.held);assert(manual.y>1.64,'Standing lifts the seated mixer immediately');
 await setup();await interact();await step(90);assert((await state()).crouched);if(mobile){await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,.95,g.room.brickWall.volume.frontZ+.85);c.lookAt(0,1.3,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step(2);await click('[data-tool="trowel"]');}else await page.keyboard.press('Digit7');await step(100);const left=await state();assert(!left.crouched&&left.y>1.64,'Switching to wall work restores only the automatically adopted crouch');
 await setup();await interact();await step(90);await page.evaluate(()=>{const b=window.__wireTheHouse.mixing.batch;b.addWater(20/3);b.openSack(0);for(let i=0;i<6;i++){b.scoopCement(0);b.pour('trowel');}for(let i=0;i<12;i++){b.scoopSand();b.pour('shovel');}b.mix(8);});await click('[data-mix-equip="mixer"]');await step(2);await click('#mixing-finish');await step(100);const finished=await state();assert(!finished.crouched&&finished.y>1.64,'FINISH restores standing after mixer assistance');
 // Deliberate player crouching must survive leaving preparation.
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.mixing.setActive(true);g.player.crouched=true;});await page.keyboard.press('Digit7');await step(100);assert((await state()).crouched,'Manually chosen crouch is preserved');
 if(mobile)await click('#quick-work-height');else await page.keyboard.press('KeyV');await step(100);const final=await state();assert(!final.crouched&&final.y>1.64);assert(!final.overflow&&!final.error);
 await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${layout.name}-standing.png`});report.cases.push({layout:layout.name,interrupted,manual,left,finished,final});await context.close();
}assert.deepEqual(report.errors,[]);}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:true,layouts:report.cases.map(c=>c.layout)}));

