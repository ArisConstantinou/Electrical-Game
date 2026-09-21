import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeLocalDist} from './local-dist-route.mjs';

const out='output/reported-mobile-workflows';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await blockPointerLock(context);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await routeLocalDist(page);
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.locator('#start-button').tap({timeout:120000});
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.testStep=g.step.bind(g);g.step=()=>{};g.mixing.finished=true;g.mixing.setActive(false);const p=g.pvc;p.stock.layout(1);p.phase='marking';p.setFocus();});
  const step=async(n=1)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.testStep(1/60);},n);
  await step(20);
  const markBefore=await page.evaluate(()=>window.__wireTheHouse.pvc.bend.mark);
  const pad=await page.locator('#look-joystick').boundingBox();assert(pad);
  const cdp=await context.newCDPSession(page),x=pad.x+pad.width/2,y=pad.y+pad.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+pad.height*.42}]});
  await step(50);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await step(2);
  const markAfter=await page.evaluate(()=>window.__wireTheHouse.pvc.bend.mark);
  assert(markAfter>markBefore+.01,`Mobile stick must move the square: ${markBefore} -> ${markAfter}`);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.markingProgress),0);
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();});
  await page.screenshot({path:`${out}/square-after.png`});

  const sequence=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,target=g.mission.points[0];p.target=target;p.focused=true;p.phase='cut';p.cutFrom=p.cutS;p.carried={recipe:p.bend.recipe(),mesh:{geometry:{dispose(){}},update(){}}};p.fitError=()=>0;p.installClear=()=>true;target.stage='leveled';p.interact();const afterCut={phase:p.phase,conduit:Boolean(target.conduit)};p.use();for(let i=0;i<40;i++)window.testStep(1/60);return{afterCut,afterInstall:{phase:p.phase,conduit:Boolean(target.conduit)}};});
  assert.deepEqual(sequence.afterCut,{phase:'pipe-install-ready',conduit:false});
  assert.deepEqual(sequence.afterInstall,{phase:'fastener-marking',conduit:true});
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();});
  await page.screenshot({path:`${out}/pipe-installed-before-holes.png`});
  const fastening=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,target=g.mission.points[0];for(let i=0;i<4;i++)p.markFastenerHole();const marked=p.fastenerHoles.length;p.startFastenerDrilling();for(let i=0;i<250;i++)window.testStep(1/60);const drilled=p.fastenerHoles.filter(h=>h.drilled).length,afterDrill=p.phase;p.use();for(let i=0;i<150;i++)window.testStep(1/60);const afterWire=p.phase;p.use();for(let i=0;i<170;i++)window.testStep(1/60);return{marked,drilled,afterDrill,afterWire,stage:target.stage,installed:p.installedCount,sequence:target.userData.pvcFasteners?.sequence};});
  assert.deepEqual(fastening,{marked:4,drilled:4,afterDrill:'fastener-insert-ready',afterWire:'fastener-tighten-ready',stage:'complete',installed:1,sequence:'pipe-inserted-marked-drilled-open-wire-twisted'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,markBefore,markAfter,sequence,errors}));
  await context.close();
} finally { await browser.close(); }
