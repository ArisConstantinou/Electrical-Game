import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const base=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.argv[3]??'output/render-motion-coherence';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={base,method:'Native A/D and touch movement on the live RAF loop. Alternate Water Pro updates deliberately delayed 100 ms to expose cross-frame scene mutations and slow-frame time loss. Desktop relative look calls PlayerController directly because OS Pointer Lock is blocked.',cases:[],errors:[]};
try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base+(mobile?'?renderer=webgl':''));await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive);
 await page.locator('#start-button')[mobile?'tap':'click']();
 await page.evaluate(async()=>{
  const g=window.__wireTheHouse,r=g.renderer,c=r.camera;await r.waitForFrame();
  // Exercise real optical passes: dry floors intentionally skip Water Pro.
  g.roomWater.addFloorWater(0,0,12);g.roomWater.rebuildGeometry();
  c.position.set(-.7,1.65,-1.5);c.lookAt(-.7,1.3,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.selectTool('hammer');
  const audit=window.__motionAudit={frames:0,pendingLooks:0,maxPositionError:0,maxAngleError:0,maxPassPositionError:0,maxPassAngleError:0,simulationSeconds:0,waterSeconds:0,catchupSteps:0};
  const step=g.step.bind(g);g.step=(dt,waterDt=dt,present=true)=>{audit.simulationSeconds+=dt;audit.waterSeconds+=waterDt;if(!present)audit.catchupSteps++;return step(dt,waterDt,present);};
  const update=r.water.update.bind(r.water);let n=0;
  r.water.update=async dt=>{
   const position=c.position.clone(),rotation=c.quaternion.clone();
   if((n++%2)===0)await new Promise(resolve=>setTimeout(resolve,100));
   audit.maxPassPositionError=Math.max(audit.maxPassPositionError,c.position.distanceTo(position));
   audit.maxPassAngleError=Math.max(audit.maxPassAngleError,c.quaternion.angleTo(rotation));
   await update(dt);
  };
  const render=r.gpu.render.bind(r.gpu);
  r.gpu.render=(scene,view)=>{
   if(!r.gpu.getRenderTarget()&&scene===r.scene){
    audit.frames++;audit.maxPositionError=Math.max(audit.maxPositionError,c.position.distanceTo(view.position));
    audit.maxAngleError=Math.max(audit.maxAngleError,c.quaternion.angleTo(view.quaternion));
   }
   return render(scene,view);
  };
 });
 const cdp=mobile?await context.newCDPSession(page):null;
 const x0=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.x);
 if(mobile){const b=await page.locator('#joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width*.5,y:b.y+b.height*.5,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width*.82,y:b.y+b.height*.5,id:1}]});}
 else await page.keyboard.down('KeyD');
 for(let i=0;i<8;i++){
  await page.waitForFunction(()=>window.__wireTheHouse.renderer.framePending);
  await page.evaluate(dx=>{const g=window.__wireTheHouse;if(g.renderer.framePending){window.__motionAudit.pendingLooks++;g.player.look(dx,0);}},i%2?4:-4);
  await page.waitForTimeout(75);
 }
 if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyD');
 // Count completed frames, rather than assuming 100 ms always completes the
 // deliberately stalled optical workload on every backend/device.
 await page.waitForFunction(()=>window.__motionAudit.frames>=12,undefined,{timeout:15000});
 const state=await page.evaluate(()=>({audit:window.__motionAudit,x:window.__wireTheHouse.renderer.camera.position.x,error:window.__wireTheHouse.renderer.renderError,pointerLock:!!document.pointerLockElement,backend:window.__wireTheHouse.roomWater.waterProBackend}));
 assert(state.audit.frames>8);assert(state.audit.pendingLooks>0);assert(state.x-x0>.1,'Held lateral movement must survive pending frames');
 assert(state.audit.catchupSteps>0,'Slow frames must catch up physics before presenting');
 assert(Math.abs(state.audit.simulationSeconds-state.audit.waterSeconds)<1e-8,'Slow rendering must not slow movement relative to water');
 for(const key of ['maxPositionError','maxAngleError','maxPassPositionError','maxPassAngleError'])assert(state.audit[key]<1e-6,`${state.backend}/${key}: ${state.audit[key]}`);
 assert.equal(state.error,'');assert.equal(state.pointerLock,false);
 await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-moving.png`});report.cases.push({...state,movedM:state.x-x0});await context.close();
}}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
