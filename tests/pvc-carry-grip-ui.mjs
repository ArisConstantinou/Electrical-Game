import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const baseline=process.argv.includes('--baseline'),out=process.env.PVC_GRIP_OUT??`output/pvc-carry-grip/${baseline?'before':'after'}`;
const base=process.env.GAME_URL??'http://127.0.0.1:5365/Electrical-Game/';
await mkdir(out,{recursive:true});
const report={baseline,errors:[],failures:[],cases:[],physicalPhone:false};
const check=(condition,label)=>{if(!condition)report.failures.push(label);};
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
await runManagedClient(session,180000,async()=>{
 try{
  for(const viewport of (process.argv.includes("--sample")?[{width:1266,height:742}]:[{width:1266,height:742},{width:390,height:844}])){
   const name=viewport.width===390?'touch':'desktop',context=await session.browser.newContext({viewport,isMobile:name==='touch',hasTouch:name==='touch'});
   await blockPointerLock(context);await serveTaskBuild(context,'http://127.0.0.1:5365/Electrical-Game/');
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base);
   await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click({timeout:60000});
   await page.waitForFunction(()=>window.__wireTheHouse.started);await page.locator('#start-screen').waitFor({state:'hidden'});
   await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.gripTick=g.step.bind(g);g.step=()=>{};cancelAnimationFrame(g.animationFrame);g.animationFrame=null;g.lifecyclePaused=true;g.player.update=()=>{};g.mixing.setActive(false);window.gripDraw={};const draw=g.renderer.drawScene.bind(g.renderer);g.renderer.drawScene=scene=>{draw(scene);window.gripDraw={calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,textures:g.renderer.webgl.info.memory.textures};};});
   for(const mark of (process.argv.includes("--sample")?[.5]:[.5,1.25,2.6])){
    await page.evaluate(mark=>{const g=window.__wireTheHouse,p=g.pvc,c=g.renderer.camera,V=c.position.constructor;
     if(p.carried){const pipe=p.carried;p.prepared.push(pipe);p.preparedRoot.add(pipe.mesh);p.carried=null;}
     p.bend=new p.bend.constructor(mark);for(let cell=0;cell<8;cell++){p.bend.grip=cell;for(let i=0;i<10;i++)p.bend.press(.05);}p.quantity=1;p.phase='extracting';p.elapsed=2;p.animate(0);
     c.position.set(2.2,1.65,.44);c.lookAt(new V(2.2,.35,-.86));c.updateMatrixWorld(true);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;for(let i=0;i<35;i++)window.gripTick(1/60);
    },mark);
    for(const pitch of (mark===2.6?[-.78,0,-.6]:[-.78,0])){
     const state=await page.evaluate(async pitch=>{const g=window.__wireTheHouse,p=g.pvc,w=g.workerBody,c=g.renderer.camera,V=c.position.constructor;const crouch=pitch===-.6;c.position.y=crouch?.95:1.65;c.rotation.set(pitch,crouch?.5:0,0,'YXZ');c.updateMatrixWorld(true);g.player.eyeHeight=c.position.y;g.player.pitch=pitch;g.player.yaw=crouch?.5:0;g.player.velocity.set(crouch?.8:0,0,crouch?-1.2:0);for(let i=0;i<5;i++)window.gripTick(1/60);
      const grip=p.anatomicalGrips().find(g=>g.active),axis=new V(0,1,0).applyQuaternion(grip.rotation),local=p.pipe.worldToLocal(grip.center.clone());let nearest={distance:Infinity,s:0};for(let i=0;i<=3000;i++){const s=p.cutFrom+(3-p.cutFrom)*i/3000,a=p.bend.at(s),d=local.distanceTo(new V(a.x,a.y,0));if(d<nearest.distance)nearest={distance:d,s};}
      const a=p.bend.at(nearest.s),tangent=new V(Math.cos(a.angle),Math.sin(a.angle),0).applyQuaternion(p.pipe.getWorldQuaternion(c.quaternion.clone())),spread=Math.abs(p.bend.at(nearest.s+.07).angle-p.bend.at(nearest.s-.07).angle);
      const thumb=w.telemetry.fingerFit.thumbContactR,thumbOffset=new V().fromArray(thumb.tip).sub(grip.center),thumbGap=thumbOffset.addScaledVector(axis,-thumbOffset.dot(axis)).length()-.01;
      await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();return{phase:p.phase,total:p.telemetry.totalAll,activeGrips:p.anatomicalGrips().filter(g=>g.active).length,nearest,axisDot:Math.abs(axis.dot(tangent)),angleSpread:spread,thumbGap,thumbSurfaceGap:(()=>{let gap=Infinity;for(const sample of w.thumbSurface.get("R")){const indices=sample.mesh.geometry.attributes.skinIndex,weights=sample.mesh.geometry.attributes.skinWeight;let weight=0;for(let j=0;j<4;j++)if(sample.mesh.skeleton.bones[indices.getComponent(sample.index,j)].name.replaceAll(".","")==="thumb03R")weight+=weights.getComponent(sample.index,j);if(weight<.6)continue;const point=new V();sample.mesh.getVertexPosition(sample.index,point);point.applyMatrix4(sample.mesh.matrixWorld);const distal=w.bone("thumb.03.R"),along=new V(0,1,0).applyQuaternion(distal.getWorldQuaternion(c.quaternion.clone()));if(point.clone().sub(w.point("thumb.03.R")).dot(along)<w.lengths.get("thumb.03.R")*.55)continue;point.sub(grip.center);const height=point.dot(axis);if(Math.abs(height)>.08)continue;point.addScaledVector(axis,-height);gap=Math.min(gap,point.length()-.01);}return gap;})(),body:w.telemetry,draw:window.gripDraw};
     },pitch);
     const label=`${name}-${mark}-${pitch===-.6?'crouch-walk':pitch===0?'level':'down'}`;
     check(state.nearest.distance<.0011,`${label}: grasp center is on the real tube`);check(state.axisDot>.999,`${label}: grasp axis follows tube tangent`);check(state.angleSpread<.01,`${label}: fingers wrap a straight section`);
     check(state.thumbSurfaceGap>=-.002&&state.thumbSurfaceGap<.005,`${label}: thumb pad contacts the cylinder`);check(state.body.gripReachErrors.R<.008,`${label}: finite arm reach`);check(state.body.fingerFit.pipeWristR.bendDegrees<5,`${label}: neutral wrist`);check(state.activeGrips===1&&state.total===100,`${label}: one hand / inventory conservation`);
     report.cases.push({label,...state});if(mark===.5||name==='touch'&&mark===2.6)await page.screenshot({path:`${out}/${label}.png`});
    }
   }
   report.performance??={};report.performance[name]=await page.evaluate(async()=>{const g=window.__wireTheHouse,times=[];for(let i=0;i<36;i++){const start=performance.now();window.gripTick(1/60);await g.renderer.waitForFrame();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return{samples:times.length,medianMs:times[18],p95Ms:times[34],maxMs:times[35],render:window.gripDraw};});
   await context.close();
  }
  check(report.errors.length===0,'no runtime errors');
 }finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
});
console.log(JSON.stringify({baseline,cases:report.cases.length,failures:report.failures,performance:report.performance,errors:report.errors}));
if(!baseline)assert.deepEqual(report.failures,[]);
