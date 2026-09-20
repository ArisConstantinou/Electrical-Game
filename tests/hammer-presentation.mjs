import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const baseline=process.argv.includes('--baseline'),out=process.env.HAMMER_REPORT_DIR??`output/hammer-presentation/${baseline?'baseline':'verified'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});const report={baseline,cases:[],errors:[],failures:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();await p.keyboard.press('Digit4');
 await p.evaluate(()=>{const g=window.__wireTheHouse;window.stepHammer=g.step.bind(g);g.step=()=>{};window.stepHammer(1/60);});
 for(const side of ['left','right'])for(const distance of [.46,.6,.9]){
  await p.locator(`#hammer-view-${side}`).click();
  const result=await p.evaluate(({side,distance})=>{
   const g=window.__wireTheHouse,c=g.renderer.camera,h=g.fpsRig.tools.get('hammer'),V=c.position.constructor;
   g.input.actionHeld=false;g.player.workPosition.locked=false;g.player.workPosition.released=false;c.position.set(0,1.65,g.room.brickWall.volume.frontZ+distance);g.player.pitch=-.2;g.player.yaw=-55*Math.PI/180;
   for(let i=0;i<120;i++)window.stepHammer(1/60);
   const samples=[],times=[];for(let i=0;i<=440;i++){
    const yaw=i<=220?-55+i*.5:55-(i-220)*.5;g.player.yaw=yaw*Math.PI/180;
    const t=performance.now();window.stepHammer(1/60);times.push(performance.now()-t);
    samples.push({yaw,p:h.getWorldPosition(new V()).toArray(),q:h.getWorldQuaternion(c.quaternion.clone()).toArray(),status:g.fpsRig.contactStatus,feed:g.fpsRig.hammerFit.feedM});
   }
   times.sort((a,b)=>a-b);return{side,distance,samples,cpuP95Ms:times[Math.floor(times.length*.95)],cpuMaxMs:times.at(-1),drawCalls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles};
  },{side,distance});
  // Measure pose acceleration only while input velocity is constant; the deliberate reversal has its own input impulse. Step bounds still cover every frame.
  let maxStep=0,maxTurn=0,maxAcceleration=0;for(let i=1;i<result.samples.length;i++){const a=result.samples[i-1],b=result.samples[i],step=Math.hypot(...b.p.map((x,j)=>x-a.p[j]));maxStep=Math.max(maxStep,step);const dot=Math.abs(b.q.reduce((s,x,j)=>s+x*a.q[j],0));maxTurn=Math.max(maxTurn,2*Math.acos(Math.min(1,dot))*180/Math.PI);if(i>1){const prev=result.samples[i-2];if((b.yaw-a.yaw)*(a.yaw-prev.yaw)>0)maxAcceleration=Math.max(maxAcceleration,Math.hypot(...b.p.map((x,j)=>x-2*a.p[j]+prev.p[j])));}}
  result.maximumStepM=maxStep;result.maximumRotationDegrees=maxTurn;result.maximumSecondDifferenceM=maxAcceleration;
  if(maxStep>.03||maxAcceleration>.02)report.failures.push(`${side}/${distance}: discontinuity ${maxStep}/${maxAcceleration}`);
  report.cases.push(result);
 }
 // Identical slow aim sweep at the original failing boundary, for before/after images.
 await p.locator('#hammer-view-right').click();await p.evaluate(()=>{const g=window.__wireTheHouse;g.player.workPosition.locked=false;g.player.workPosition.released=false;g.renderer.camera.position.set(-.7,1.65,g.room.brickWall.volume.frontZ+.9);g.player.yaw=-55*Math.PI/180;g.player.pitch=-.2;for(let i=0;i<120;i++)window.stepHammer(1/60);});
 for(let i=0;i<=21;i++){await p.evaluate(i=>{window.__wireTheHouse.player.yaw=(-55+i*.5)*Math.PI/180;window.stepHammer(1/60);},i);if(i===14||i===15)await p.screenshot({path:`${out}/boundary-${i}.png`});}
 await p.locator('#model-inspector-open').click();await p.waitForFunction(()=>window.__wireTheHouse.modelInspector.worker?.loaded);await p.selectOption('#model-tool','hammer');await p.waitForTimeout(100);
 report.handle=await p.evaluate(()=>{const g=window.__wireTheHouse,m=g.modelInspector;m.playing=false;m.updatePose(0);const h=m.rig.tools.get('hammer'),aux=h.getObjectByName('Rotatable auxiliary handle'),shaft=h.getObjectByName('Auxiliary handle clamp spindle'),rubber=h.getObjectByName('Auxiliary rubber hand grip');m.worker.visible=false;aux.updateWorldMatrix(true,true);
 const range=mesh=>{const v=mesh.position.clone(),a=mesh.geometry.attributes.position,values=[];mesh.updateMatrix();for(let i=0;i<a.count;i++)values.push(v.fromBufferAttribute(a,i).applyMatrix4(mesh.matrix).x);return{min:Math.min(...values),max:Math.max(...values)};};const s=range(shaft),r=range(rubber),gap=s.min-r.max;
 const target=aux.localToWorld(aux.position.clone().set(-.083,-.010,-.025));m.controls.target.copy(target);m.camera.position.copy(target).add(target.clone().set(.14,.10,.22));m.camera.near=.005;m.camera.updateProjectionMatrix();m.controls.update();g.renderer.render();return {gapM:gap,overlapM:-gap};});
 await p.waitForTimeout(100);await p.screenshot({path:`${out}/handle.png`});if(report.handle.overlapM<.01)report.failures.push('Auxiliary spindle does not overlap rubber grip');
 report.passed=report.failures.length===0&&report.errors.length===0;await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log({baseline,cases:report.cases.map(({side,distance,maximumStepM,maximumSecondDifferenceM,cpuP95Ms})=>({side,distance,maximumStepM,maximumSecondDifferenceM,cpuP95Ms})),handle:report.handle,failures:report.failures,errors:report.errors});
 if(!baseline){assert.deepEqual(report.failures,[]);assert.deepEqual(report.errors,[]);}
}finally{await browser.close();}
