import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/building-jump-animation';await mkdir(out,{recursive:true});
const report={cases:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:800}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;await g.renderer.waitForFrame();window.qaStep=g.step.bind(g);g.step=()=>{};});
 for(const tool of ['spray','hammer','drill','trowel','fitting','hose','measure','driver','level','spring','cutter','laser']){
  await page.evaluate(tool=>{const g=window.__wireTheHouse;g.selectTool(tool);g.player.camera.position.set(23,1.65,-14);g.player.yaw=0;g.player.pitch=-.22;g.player.workPosition.locked=false;g.player.workPosition.released=true;for(let i=0;i<80;i++)window.qaStep(1/60,1/60,false);},tool);
  const frames=[];
  for(let i=0;i<=65;i++){
   if(i===1)await page.keyboard.press('Space');
   const frame=await page.evaluate(i=>{
    const g=window.__wireTheHouse;window.qaStep(1/60,1/60,false);const p=g.player,b=g.workerBody,c=g.renderer.camera,V=c.position.constructor;
    const frame={i,...p.jumpPose,height:p.jumpOffset,bodyY:b.position.y,gripErrors:b.telemetry.gripReachErrors,hands:{},feet:{}};
    for(const side of ['R','L']){
     const hand=b.bone('hand.'+side),q=hand.getWorldQuaternion(c.quaternion.clone()),fore=b.point('hand.'+side).sub(b.point('forearm.'+side)).normalize();
     const neutral=new V(0,1,0).applyQuaternion(q.clone().multiply(b.handFrames.get(side).foreToHand.clone().invert()));
     frame.hands[side]={position:b.point('hand.'+side).toArray(),elbow:b.point('forearm.'+side).toArray(),shoulder:b.point('upper_arm.'+side).toArray(),wrist:fore.angleTo(neutral)*180/Math.PI};
     frame.feet[side]=b.point('foot.'+side).toArray();
    }
    return frame;
   },i);frames.push(frame);
   if(['spray','hammer','drill','measure','laser'].includes(tool)&&[0,3,21,41].includes(i)){
    const label=i===0?'idle':i===3?'takeoff':i===21?'apex':'landing';
    await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
    await page.screenshot({path:`${out}/${tool}-${label}-fps.png`});
    await page.evaluate(()=>{
     const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor;window.qaView={position:c.position.clone(),quaternion:c.quaternion.clone(),fov:c.fov,parent:g.fpsRig.parent};
     g.renderer.scene.attach(g.fpsRig);c.position.set(25.35,2.15,-17.15);c.lookAt(new V(23,1.2,-14.15));c.fov=43;c.updateProjectionMatrix();g.workerBody.headMaterials.forEach(m=>{m.colorWrite=true;m.depthWrite=true;});g.siteOcclusion?.restore();g.renderer.render();
    });
    await page.screenshot({path:`${out}/${tool}-${label}-body.png`});
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,s=window.qaView;c.position.copy(s.position);c.quaternion.copy(s.quaternion);c.fov=s.fov;c.updateProjectionMatrix();c.updateMatrixWorld(true);s.parent.attach(g.fpsRig);g.workerBody.headMaterials.forEach(m=>{m.colorWrite=false;m.depthWrite=false;});});
   }
  }
  const apex=frames.reduce((a,b)=>b.height>a.height?b:a),idle=frames[0];
  report.cases.push({tool,frames});
  assert(apex.height>.48);assert(frames.some(f=>f.phase==='takeoff'));assert(frames.some(f=>f.phase==='landing'&&f.compression>.07));assert.equal(frames.at(-1).phase,'grounded');
  assert(apex.feet.R[1]-apex.bodyY>idle.feet.R[1]-idle.bodyY+.08,'Knees must tuck');
  if(tool==='spray'||tool==='drill')assert(apex.hands.R.position[0]>idle.hands.R.position[0]+.08,'Loaded right arm must open laterally');
  if(tool==='hammer')for(const f of frames)for(const error of Object.values(f.gripErrors))assert(error<.025,`Hammer hand detached ${error}`);
  for(const f of frames){
   for(const hand of Object.values(f.hands))assert(hand.wrist<25,`${tool} ${f.phase}: wrist bend ${hand.wrist}`);
   for(const error of Object.values(f.gripErrors))assert(error<.006,`${tool} ${f.phase}: hand detached ${error}`);
  }
 }
 assert.deepEqual(report.errors,[]);report.passed=true;await context.close();
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,tools:report.cases.map(c=>c.tool),errors:report.errors}));
