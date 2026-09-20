import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/ceiling-grips',asset='assets/poses/ceiling-grips.reference.json';
await mkdir(out,{recursive:true});await mkdir('assets/poses',{recursive:true});
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const sources=['src/player/WorkerBody.ts','src/player/FPSRig.ts','src/systems/MixingStation.ts','public/assets/worker/worker.glb'];
const hashes=Object.fromEntries(await Promise.all(sources.map(async f=>[f,await hash(f)])));
const report={version:1,status:'captured reference, not runtime-enabled or visually approved for every tool',units:'metres',rotation:'quaternion [x,y,z,w]; local means parent bone space',gripSpace:'origin at authored grip center; quaternion is authored grip world orientation',sourceHashes:hashes,poses:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:900}});await blockPointerLock(ctx);const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();await p.waitForTimeout(650);
 await p.evaluate(()=>{const g=window.__wireTheHouse;window.captureStep=g.step.bind(g);g.step=()=>{};g.input.locked=false;});
 const cases=['spray','hammer:right','hammer:left','fitting:1G','fitting:2G','fitting:2G+1G','level','spring','cutter','trowel','hose','measure','drill','driver','laser','mix:water','mix:trowel','mix:shovel','mix:mixer'];
 for(const id of cases){
  if(id.startsWith('hammer:'))await p.locator('#hammer-view-'+id.split(':')[1]).evaluate(el=>el.click());
  const data=await p.evaluate(async id=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,station=id.startsWith('mix:'),tool=station?id.slice(4):id.split(':')[0];
   g.mixing.setActive(station);if(station)g.mixing.chooseTool(tool);else g.selectTool(tool);
   if(tool==='fitting')g.fpsRig.setFittingBoxKinds(id.split(':')[1].split('+'));
   g.player.workPosition.locked=false;g.player.workPosition.released=true;g.player.crouched=false;g.player.velocity.set(0,0,0);g.player.yaw=0;g.player.pitch=1.0;g.input.actionHeld=false;g.input.actionRequested=false;
   c.position.set(-.6,1.65,g.room.brickWall.volume.frontZ+1.1);g.renderer.viewCamera=null;w.overview=false;
   for(let i=0;i<80;i++)window.captureStep(1/60);
   const object=station?g.mixing.heldTools.get(tool):g.fpsRig.tools.get(tool),Q=c.quaternion.constructor;
   const grips=(station?g.mixing.anatomicalGrips():g.fpsRig.anatomicalGrips()).filter(x=>x.active),arms=[];
   for(const grip of grips){
    const side=grip.side>0?'R':'L',inverse=grip.rotation.clone().invert(),wrist=w.point('hand.'+side),fore=wrist.clone().sub(w.point('forearm.'+side)),long=w.point('middle.01.'+side).sub(wrist);
    const names=['clavicle','upper_arm','forearm','hand',...['thumb','index','middle','ring','little'].flatMap(d=>[1,2,3].map(n=>`${d}.0${n}`))].map(n=>n+'.'+side);
    const joints=names.map(name=>{const b=w.bone(name),position=b.getWorldPosition(c.position.clone()),rotation=b.getWorldQuaternion(new Q()),inGrip=position.clone().sub(grip.center).applyQuaternion(inverse),qInGrip=inverse.clone().multiply(rotation);
     const restored=inGrip.clone().applyQuaternion(grip.rotation).add(grip.center),restoredQ=grip.rotation.clone().multiply(qInGrip);
     return{name,localPosition:b.position.toArray(),localQuaternion:b.quaternion.toArray(),worldPosition:position.toArray(),worldQuaternion:rotation.toArray(),positionInGrip:inGrip.toArray(),quaternionInGrip:qInGrip.toArray(),reconstructionPositionErrorM:restored.distanceTo(position),reconstructionAngleErrorRadians:restoredQ.clone().normalize().angleTo(rotation.clone().normalize())};
    });
    arms.push({side,wristBendDegrees:long.angleTo(fore)*180/Math.PI,grip:{center:grip.center.toArray(),quaternion:grip.rotation.toArray(),section:grip.section,shape:grip.shape??'round',trigger:grip.trigger?.toArray()},joints});
   }
   g.renderer.render();await g.renderer.waitForFrame();
   return{id,tool,station,camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),pitch:g.player.pitch,yaw:g.player.yaw},body:{position:w.position.toArray(),quaternion:w.quaternion.toArray()},object:{position:object.getWorldPosition(c.position.clone()).toArray(),quaternion:object.getWorldQuaternion(new Q()).toArray(),scale:object.getWorldScale(c.position.clone()).toArray()},arms};
  },id);
  report.poses.push(data);const slug=id.replaceAll(':','-').replaceAll('+','_');await p.screenshot({path:`${out}/${slug}-ceiling.png`});
  for(const arm of data.arms){
   await p.evaluate(async side=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.modelInspector.camera,V=c.position.constructor;w.overview=true;const target=w.point('hand.'+side).lerp(w.point('middle.01.'+side),.5);c.position.copy(target).add(new V(side==='R'?.32:-.32,.16,.38));c.lookAt(target);c.fov=45;c.aspect=1.6;c.near=.005;c.updateProjectionMatrix();g.renderer.viewCamera=c;g.renderer.render();await g.renderer.waitForFrame();},arm.side);
   await p.screenshot({path:`${out}/${slug}-${arm.side}.png`});
  }
 }
 assert.deepEqual(report.errors,[]);
 for(const pose of report.poses)for(const arm of pose.arms)for(const joint of arm.joints){assert(joint.reconstructionPositionErrorM<1e-8);assert(joint.reconstructionAngleErrorRadians<1e-5);assert(joint.localQuaternion.every(Number.isFinite));}
 for(const f of sources)assert.equal(await hash(f),hashes[f],`Unexpected source change ${f}`);
 report.captureVerified=true;await writeFile(asset,JSON.stringify(report,null,2));
 const rows=report.poses.flatMap(p=>p.arms.map(a=>`| ${p.id} | ${a.side} | ${a.wristBendDegrees.toFixed(1)}° |`));
 await writeFile(`${out}/README.md`,`# Captured ceiling poses\n\nCamera pitch: 1 radian (57.3 degrees upward), yaw: 0. Standing, idle; no working animation captured.\n\nSource: ${asset}\n\nThese are exact captured poses, not corrected anatomy. Reconstruction checks passed; source files unchanged. No runtime playback enabled.\n\n| Tool | Hand | Wrist bend |\n|---|---|---|\n${rows.join('\n')}\n`);
 console.log(JSON.stringify({poses:report.poses.length,hands:report.poses.reduce((n,p)=>n+p.arms.length,0),captureVerified:true,asset,wrists:report.poses.map(p=>({id:p.id,arms:p.arms.map(a=>[a.side,+a.wristBendDegrees.toFixed(1)])}))},null,2));
}finally{await writeFile(`${out}/capture-report.json`,JSON.stringify(report,null,2));await browser.close();}
