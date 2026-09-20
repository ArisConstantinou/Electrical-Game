import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out=process.argv[2]??'output/box-grip-contact';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:2076,height:641}});await blockPointerLock(context);
 const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();
 await p.evaluate(()=>{const g=window.__wireTheHouse;window.contactStep=g.step.bind(g);g.step=()=>{};g.input.locked=false;g.selectTool('fitting');g.player.velocity.set(0,0,0);g.player.workPosition.locked=false;g.player.workPosition.released=true;});
 for(const shape of ['six','single','rotated-2G']){
  await p.evaluate(shape=>{const g=window.__wireTheHouse;g.boxAssembly.reset(shape==='rotated-2G'?'2G':'1G');if(shape==='six')for(const z of [2,1,4,1,2])g.boxAssembly.attach(z);if(shape==='rotated-2G')g.boxAssembly.rotateCandidate();g.syncBoxAssembly();},shape);
  for(const [label,pitch,yaw] of [['straight',0,Math.PI],['down',-1.15,Math.PI],['up',1.15,Math.PI],['left',0,Math.PI-.8],['right',0,Math.PI+.8]]){
   const result=await p.evaluate(async({shape,label,pitch,yaw})=>{
    const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.player.pitch=pitch;g.player.yaw=yaw;c.position.set(-.6,1.65,g.room.brickWall.volume.frontZ+1.1);
    for(let i=0;i<50;i++)window.contactStep(1/60);g.renderer.render();await g.renderer.waitForFrame();
    const rows=g.fpsRig.anatomicalGrips().filter(g=>g.active).map(grip=>{
     const side=grip.side>0?'R':'L',q=grip.rotation,inv=q.clone().invert(),point=n=>w.point(n+'.'+side);
     const coords=v=>v.clone().sub(grip.center).applyQuaternion(inv).toArray();
     const tip=n=>{const b=w.bone(n+'.03.'+side),a=point(n+'.03');return a.add(a.clone().set(0,w.lengths.get(n+'.03.'+side),0).applyQuaternion(b.getWorldQuaternion(q.clone())));};
     const wrist=point('hand'),long=point('middle.01').sub(wrist),fore=wrist.clone().sub(point('forearm'));
     const boxes=grip.object.children.filter(o=>o.userData.boxKind).map(box=>({kind:box.userData.boxKind,width:box.width,worldScale:box.getWorldScale(c.position.clone()).toArray()}));
     const digits=['index','middle','ring','little'];
     return{side,sign:grip.side,boxes,boxCameraAngle:q.angleTo(c.getWorldQuaternion(q.clone()))*180/Math.PI,bend:long.angleTo(fore)*180/Math.PI,
      tips:Object.fromEntries([...digits,'thumb'].map(n=>[n,coords(tip(n))])),
      hinges:digits.flatMap(d=>[1,2,3].map(j=>(w.boxFingerAxes??w.fingerAxes).get(`${d}.0${j}.${side}`).y)),
      boneTranslationMax:Math.max(...digits.flatMap(d=>[1,2,3].map(j=>{const b=w.bone(`${d}.0${j}.${side}`);return b.position.distanceTo(w.rest.get(b).p);}))),
      angles:Object.fromEntries(digits.map(d=>[d,w.telemetry.fingerFit[d+side]?.angles]))};
    });return{shape,label,rows};
   },{shape,label,pitch,yaw});report.cases.push(result);
   if(shape==='six'&&['straight','down','up'].includes(label))await p.screenshot({path:`${out}/${label}.png`});
   for(const row of result.rows){
    const id=`${shape}/${label}/${row.side}`;
    assert(row.boxCameraAngle<.1,`${id}: casing tilts ${row.boxCameraAngle.toFixed(1)} degrees`);
    assert(row.bend<1,`${id}: wrist bends`);
    assert(row.boxes.length>0);for(const box of row.boxes){assert.equal(box.width,box.kind==='1G'?.074:.134);assert(box.worldScale.every(v=>Math.abs(v-1)<1e-6),`${id}: casing shrinks relative to the hand`);}
    for(const [digit,target] of [['index',[row.sign*.010,.020,0]],['middle',[row.sign*.010,row.side==='R'?-.006:-.012,0]],['thumb',[-row.sign*.010,.020,0]]]){
     const error=Math.hypot(...row.tips[digit].map((v,i)=>v-target[i]));assert(error<.003,`${id}: ${digit} pad misses casing contact by ${(error*1000).toFixed(1)} mm`);
    }
    assert(row.hinges.every(v=>Math.abs(v)<1e-8),`${id}: finger hinges contain longitudinal twist`);
    assert(row.boneTranslationMax<1e-8,`${id}: finger bones stretch`);
    for(const angles of Object.values(row.angles)){assert(angles);assert(angles.slice(1).every((v,i)=>v>=-1e-6&&v<=[78,101,72][i]),`${id}: finger joint over-flexes`);}
   }
  }
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify({passed:true,cases:report.cases.length,contactToleranceMm:3}));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
