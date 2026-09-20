import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const out=process.argv[2]??'output/box-grip-visibility';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[],scope:'Desktop and portrait Chromium emulation; portrait is not physical iPhone proof.'};
const overlap=(a,b)=>Math.min(a.maxX,b.maxX)>Math.max(a.minX,b.minX)&&Math.min(a.maxY,b.maxY)>Math.max(a.minY,b.minY);
const inside=b=>b.minX>=-1&&b.maxX<=1&&b.minY>=-1&&b.maxY<=1;
try{
 for(const [viewport,width,height,mobile] of [['desktop',1366,768,false],['portrait',390,844,true]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(`${viewport}: ${e.message}`));
  await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button')[mobile?'tap':'click']();
  await p.evaluate(()=>{const g=window.__wireTheHouse;window.contactStep=g.step.bind(g);g.step=()=>{};g.input.locked=false;g.selectTool('fitting');window.dispatchEvent(new CustomEvent('wirehouse:box-enter-assembly'));g.player.velocity.set(0,0,0);g.player.workPosition.locked=false;g.player.workPosition.released=true;});
  for(const shape of ['six','zigzag','single','rotated-2G']){
   await p.evaluate(shape=>{const g=window.__wireTheHouse;g.boxAssembly.reset(shape==='rotated-2G'?'2G':'1G');if(shape==='six')for(const z of [2,1,4,1,2])g.boxAssembly.attach(z);if(shape==='zigzag')for(const z of [2,3,2,3])g.boxAssembly.attach(z);if(shape==='rotated-2G')g.boxAssembly.rotateCandidate();g.syncBoxAssembly();},shape);
   for(const [label,pitch,yaw] of [['straight',0,Math.PI],['down',-1.15,Math.PI],['up',1.15,Math.PI],['left',0,Math.PI-.8],['right',0,Math.PI+.8]]){
    const result=await p.evaluate(async({viewport,shape,label,pitch,yaw})=>{
     const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;c.position.set(-.6,1.65,g.room.brickWall.volume.frontZ+1.1);const cameraBefore=c.position.clone();g.player.pitch=pitch;g.player.yaw=yaw;
     for(let i=0;i<50;i++)window.contactStep(1/60);g.renderer.render();await g.renderer.waitForFrame();
     const rows=g.fpsRig.anatomicalGrips().filter(g=>g.active).map(grip=>{
      const side=grip.side>0?'R':'L',q=grip.rotation,inv=q.clone().invert(),point=n=>w.point(n+'.'+side);
      const coords=v=>v.clone().sub(grip.center).applyQuaternion(inv).toArray();
      const tip=n=>{const b=w.bone(n+'.03.'+side),a=point(n+'.03');return a.add(a.clone().set(0,w.lengths.get(n+'.03.'+side),0).applyQuaternion(b.getWorldQuaternion(q.clone())));};
      const wrist=point('hand'),long=point('middle.01').sub(wrist),fore=wrist.clone().sub(point('forearm'));
      const boxes=grip.object.children.filter(o=>o.userData.boxKind).map(box=>({kind:box.userData.boxKind,width:box.width,worldScale:box.getWorldScale(c.position.clone()).toArray()})),digits=['index','middle','ring','little'];
      return{side,sign:grip.side,boxes,boxCameraAngle:q.angleTo(c.getWorldQuaternion(q.clone()))*180/Math.PI,bend:long.angleTo(fore)*180/Math.PI,tips:Object.fromEntries([...digits,'thumb'].map(n=>[n,coords(tip(n))])),hinges:digits.flatMap(d=>[1,2,3].map(j=>(w.boxFingerAxes??w.fingerAxes).get(`${d}.0${j}.${side}`).y)),boneTranslationMax:Math.max(...digits.flatMap(d=>[1,2,3].map(j=>{const b=w.bone(`${d}.0${j}.${side}`);return b.position.distanceTo(w.rest.get(b).p);}))),angles:Object.fromEntries(digits.map(d=>[d,w.telemetry.fingerFit[d+side]?.angles]))};
     });
     const screen=root=>{const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};root.updateWorldMatrix(true,true);root.traverse(o=>{if(!o.geometry?.attributes.position)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=c.position.clone().set(a.getX(i),a.getY(i),a.getZ(i)).applyMatrix4(o.matrixWorld).project(c);bounds.minX=Math.min(bounds.minX,v.x);bounds.maxX=Math.max(bounds.maxX,v.x);bounds.minY=Math.min(bounds.minY,v.y);bounds.maxY=Math.max(bounds.maxY,v.y);}});return bounds;};
     const rightHandPoints=['hand.R','index.01.R','index.02.R','index.03.R','middle.01.R','middle.02.R','middle.03.R','ring.01.R','ring.02.R','ring.03.R','little.01.R','little.02.R','little.03.R','thumb.01.R','thumb.02.R','thumb.03.R'].map(name=>w.point(name).project(c));
     const rightHand={minX:Math.min(...rightHandPoints.map(v=>v.x))-.02,maxX:Math.max(...rightHandPoints.map(v=>v.x))+.02,minY:Math.min(...rightHandPoints.map(v=>v.y))-.02,maxY:Math.max(...rightHandPoints.map(v=>v.y))+.02};
     return{viewport,shape,label,rows,cameraMovement:cameraBefore.distanceTo(c.position),assembly:screen(g.fpsRig.fittingAssemblyRoot),candidate:screen(g.fpsRig.fittingCandidateRoot),zones:g.fpsRig.fittingZonesRoot.children.map(screen),rightHand};
    },{viewport,shape,label,pitch,yaw});report.cases.push(result);
    if(shape==='six'&&['straight','down','up'].includes(label))await p.screenshot({path:`${out}/${viewport}-${label}.png`});
    const {assembly:a,candidate:b,zones:z,rightHand:h}=result,id=`${viewport}/${shape}/${label}`;
    assert(!overlap(a,b),`${id}: next box is hidden by the assembly`);assert(z.every(zone=>!overlap(zone,b)),`${id}: next box overlaps attachment zones`);
    assert(!overlap(a,h),`${id}: right hand is hidden by the assembly`);assert(z.every(zone=>!overlap(zone,h)),`${id}: right hand overlaps an attachment zone`);
    assert([a,b,h,...z].every(inside),`${id}: assembly, candidate, hand or a numbered zone leaves the viewport`);assert(result.cameraMovement<1e-9,`${id}: looking moved the gameplay camera by ${result.cameraMovement} m`);
    for(const row of result.rows){
     const gripId=`${id}/${row.side}`;assert(row.boxCameraAngle<.1,`${gripId}: casing tilts ${row.boxCameraAngle.toFixed(1)} degrees`);assert(row.bend<1,`${gripId}: wrist bends`);
     assert(row.boxes.length>0);for(const box of row.boxes){assert.equal(box.width,box.kind==='1G'?.074:.134);assert(box.worldScale.every(v=>Math.abs(v-1)<1e-6),`${gripId}: casing shrinks relative to the hand`);}
     for(const [digit,target] of [['index',[row.sign*.010,.020,0]],['middle',[row.sign*.010,row.side==='R'?-.006:-.012,0]],['thumb',[-row.sign*.010,.020,0]]]){const error=Math.hypot(...row.tips[digit].map((v,i)=>v-target[i]));assert(error<.0031,`${gripId}: ${digit} pad misses casing contact by ${(error*1000).toFixed(1)} mm`);}
     assert(row.hinges.every(v=>Math.abs(v)<1e-8),`${gripId}: finger hinges contain longitudinal twist`);assert(row.boneTranslationMax<1e-8,`${gripId}: finger bones stretch`);
     for(const angles of Object.values(row.angles)){assert(angles);assert(angles.slice(1).every((v,i)=>v>=-1e-6&&v<=[78,101,72][i]),`${gripId}: finger joint over-flexes`);}
    }
   }
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify({passed:true,cases:report.cases.length,viewports:['desktop','portrait'],contactToleranceMm:3}));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
