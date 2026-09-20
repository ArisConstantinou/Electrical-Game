import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv.find(a=>/^https?:/.test(a))??'http://127.0.0.1:5365/Electrical-Game/';
const repro=process.argv.includes('--repro');
const out='output/mixing-input-recovery';await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,repro,cases:[],errors:[],passed:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const layout of [{name:'desktop',width:1366,height:768,mobile:false},{name:'portrait',width:390,height:844,mobile:true},{name:'landscape',width:844,height:390,mobile:true}]){
    const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:layout.mobile,hasTouch:layout.mobile});await blockPointerLock(context);
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
    await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});await page.locator('#start-button')[layout.mobile?'tap':'click']();await page.waitForTimeout(350);
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__recoveryStep=g.step.bind(g);g.step=()=>{};window.__wallCalls=0;const perform=g.performAction.bind(g);g.performAction=(...args)=>{window.__wallCalls++;return perform(...args);};});
    const step=(count=1)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__recoveryStep(1/60);},count);
    const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{mixing:g.mixing.telemetry,audio:g.audio.telemetry,input:{actionHeld:g.input.actionHeld,interactionHeld:g.input.interactionHeld},wallCalls:window.__wallCalls,launched:g.mortar.telemetry.launchedKg,overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError};});
    const aim=async()=>{await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.player.crouched=true;c.position.set(-.75,.95,1.88);c.lookAt(-.75,.3,2.28);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);});await step(2);};
    const equip=async(tool)=>{await page.locator(`[data-mix-equip="${tool}"]`)[layout.mobile?'tap':'click']();await step(2);};
    const cdp=layout.mobile?await context.newCDPSession(page):null;
    const down=async(kind)=>{if(layout.mobile){const box=await page.locator(kind==='use'?'#look-joystick':'#mobile-interact').boundingBox();assert(box,`${kind} input visible`);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:71}]});}else if(kind==='use'){await page.mouse.move(layout.width/2,layout.height*.42);await page.mouse.down();}else await page.keyboard.down('KeyE');};
    const up=async(kind)=>{if(layout.mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else if(kind==='use')await page.mouse.up();else await page.keyboard.up('KeyE');await step(2);};
    const press=async(kind,frames=1)=>{await down(kind);await step(frames);await up(kind);};
    const shot=async(name)=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${layout.name}-${name}.png`});};
    await aim();await equip('water');await equip('water');const putDown=await state();
    if(!repro)assert.equal(putDown.mixing.tool,'hands','Clicking the equipped jug returns it to the station');
    // Prepare an actual inventory through its public operations; input below is real browser input.
    await page.evaluate(()=>{const b=window.__wireTheHouse.mixing.batch;b.addWater(20/3);b.openSack(0);for(let i=0;i<6;i++){b.scoopCement(0);b.pour('trowel');}for(let i=0;i<12;i++){b.scoopSand();b.pour('shovel');}});
    await equip('mixer');await aim();await down('use');const useInput=await state();await step(60);const useHeld=await state();await up('use');const useReleased=await state();
    if(repro){report.cases.push({layout:layout.name,putDown:putDown.mixing.tool,useInput:useInput.input,useHeld:useHeld.mixing,useReleased:useReleased.mixing});await context.close();continue;}
    assert.equal(useInput.input.actionHeld,true,'Real USE reaches action input');
    assert.equal(useInput.input.interactionHeld,false,'USE is independent of INTERACT');
    assert(useHeld.mixing.inserted&&useHeld.mixing.mixing,'USE inserts and runs the mixer');assert(useHeld.mixing.batch.mixProgress>0,'USE advances actual mixture');assert(useHeld.audio.activeLoops.mixer,'USE runs continuous mixer sound');
    assert.equal(useReleased.mixing.mixing,false,'Releasing USE stops mixer');assert.equal(Boolean(useReleased.audio.activeLoops.mixer),false,'Releasing USE stops motor sound');await step(60);assert.equal((await state()).mixing.batch.mixProgress,useReleased.mixing.batch.mixProgress,'Released mixer cannot advance mixture');
    await down('interact');await step(60);const interactHeld=await state();assert(interactHeld.mixing.mixing,'INTERACT also runs mixer');assert(interactHeld.mixing.batch.mixProgress>useReleased.mixing.batch.mixProgress);await shot('mixer-running');await up('interact');assert.equal((await state()).mixing.mixing,false);
    // Put down an inserted mixer before the remaining jug sequence.
    const beforeMixerPutDown=await state();await equip('mixer');const mixerPutDown=await state();assert.equal(mixerPutDown.mixing.tool,'hands','Equipped mixer can be put away');assert.equal(mixerPutDown.mixing.inserted,false,'Putting mixer away lifts it from bucket');assert.equal(mixerPutDown.mixing.batch.massKg,beforeMixerPutDown.mixing.batch.massKg,'Putting mixer away preserves all ingredients');assert.equal(mixerPutDown.mixing.batch.mixProgress,beforeMixerPutDown.mixing.batch.mixProgress,'Putting mixer away preserves mixing progress');
    await page.evaluate(()=>{window.__wireTheHouse.mixing.batch.discard();});await equip('water');assert.equal((await state()).mixing.tool,'water','Jug can be picked up again');assert.match(await page.locator('[data-mix-equip="water"]').innerText(),/ΑΦΗΣΕ/,'Selected jug explicitly offers put-down');await aim();await press('use');await step(45);await equip('water');const pendingHands=await state();assert.equal(pendingHands.mixing.activity,'water','Put-down request does not interrupt active pour');assert.equal(pendingHands.mixing.tool,'water','Jug stays in hand until pour ends');await step(100);const pouredAndPutDown=await state();assert.equal(pouredAndPutDown.mixing.tool,'hands','Queued jug put-down completes after pour');assert.equal(await page.evaluate(()=>window.__wireTheHouse.mixing.models.water.visible),true,'Jug returns visibly to station');assert(Math.abs(pouredAndPutDown.mixing.batch.waterLitres-20/3)<1e-8,'Queued put-down preserves exactly one-third water');await shot('jug-put-down');
    await equip('water');await equip('water');assert.equal((await state()).mixing.tool,'hands','Jug also puts down immediately after pouring');
    await equip('water');await aim();await press('use');await equip('shovel');const queued=await state();assert.equal(queued.mixing.activity,'water','Water stroke completes before switching');assert.equal(queued.mixing.tool,'water','Jug remains held throughout its pour');await step(100);const switched=await state();assert.equal(switched.mixing.tool,'shovel','Tool selection during pour applies after completion');assert.equal(switched.mixing.activity,null);await shot('queued-switch');
    let mobileStatus=null;if(layout.mobile){mobileStatus=await page.locator('#mobile-use-status').evaluate(el=>({text:el.textContent,bounds:el.getBoundingClientRect().toJSON(),fontSize:parseFloat(getComputedStyle(el).fontSize)}));assert(mobileStatus.bounds.x>=0&&mobileStatus.bounds.right<=layout.width,'Mobile USE status must remain inside viewport');assert(mobileStatus.fontSize>=12,'Mobile USE status remains readable');}
    assert.equal(switched.wallCalls,0,'Station USE and INTERACT must not leak wall actions');assert.equal(switched.launched,0,'Station input must not launch wall mortar');assert.equal(switched.overflow,false);assert.equal(switched.renderError,'');report.cases.push({layout:layout.name,useHeld,useReleased,interactHeld,pendingHands,pouredAndPutDown,mixerPutDown,queued,switched,mobileStatus});await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=!repro;
}finally{await writeFile(`${out}/${repro?'repro':'report'}.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,repro,layouts:report.cases.map(c=>c.layout),report:`${out}/${repro?'repro':'report'}.json`}));
