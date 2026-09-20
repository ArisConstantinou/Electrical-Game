import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const backend=process.env.WORKER_BACKEND||'webgl',out=`output/worker-three-fixes/${backend}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.QA_BASE??'http://127.0.0.1:5365/Electrical-Game/';await page.goto(`${base}?renderer=${backend}`);await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await page.locator('#start-button').click();
 await page.waitForTimeout(800);
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=()=>{};g.input.locked=false;});
 const results=[];
 for(const [name,pitch,crouch,working]of [['idle',-.25,false,false],['spraying',-.25,false,true],['down',-1.08,false,false],['crouch',-.75,true,true]]){
  const data=await page.evaluate(async({pitch,crouch,working})=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;
   g.player.yaw=0;g.player.pitch=pitch;g.player.crouched=crouch;g.player.velocity.set(0,0,0);c.position.set(-.5,crouch?.95:1.65,-1.3);c.rotation.set(pitch,0,0);g.fpsRig.show('spray');g.fpsRig.visible=true;w.overview=false;
   for(let i=0;i<80;i++)w.update(1/60,c,g.player,g.fpsRig,'spray',working,false);
   const contact=w.telemetry.fingerFit.thumbContactR,head=[];let minimumClearance=Infinity,vertices=0,buttonGap=Infinity,buttonVertices=0;
   const button=g.fpsRig.tools.get('spray').getObjectByName('Broad finger press actuator');button.geometry.computeBoundingBox();const buttonInverse=button.matrixWorld.clone().invert(),buttonTop=button.geometry.boundingBox.max.y;
   w.traverse(o=>{
    if(!o.isSkinnedMesh)return;o.skeleton.update();
    let isHead=false;for(let p=o;p;p=p.parent)if(w.headParts.includes(p))isHead=true;
    if(isHead)head.push({visible:o.visible,cast:o.castShadow,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({color:m.colorWrite,depth:m.depthWrite}))});
    const indices=o.geometry.attributes.skinIndex,weights=o.geometry.attributes.skinWeight,v=w.position.clone();
    const thumbs=new Set(o.skeleton.bones.map((b,i)=>b.name.replaceAll('.','').startsWith('thumb')&&b.name.endsWith('R')?i:-1));thumbs.delete(-1);
    const fingertips=new Set(o.skeleton.bones.map((b,i)=>b.name.replaceAll('.','')==='index03R'?i:-1));fingertips.delete(-1);
    for(let i=0;i<indices.count;i++){
     let indexWeight=0;for(let j=0;j<4;j++)if(fingertips.has(indices.getComponent(i,j)))indexWeight+=weights.getComponent(i,j);
     if(indexWeight>=.75){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld).applyMatrix4(buttonInverse);if(Math.abs(v.x)<.012&&Math.abs(v.z)<.010){buttonGap=Math.min(buttonGap,v.y-buttonTop);buttonVertices++;}}
     let weight=0;for(let j=0;j<4;j++)if(thumbs.has(indices.getComponent(i,j)))weight+=weights.getComponent(i,j);if(weight<.75)continue;
     o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);
     const dx=v.x-contact.center[0],dy=v.y-contact.center[1],dz=v.z-contact.center[2],height=dx*contact.axis[0]+dy*contact.axis[1]+dz*contact.axis[2];
     if(height<-.09||height>.083)continue;
     minimumClearance=Math.min(minimumClearance,Math.hypot(dx-height*contact.axis[0],dy-height*contact.axis[1],dz-height*contact.axis[2])-.0335);vertices++;
    }
   });
   g.renderer.render();await g.renderer.waitForFrame();
   const buttonScreen=button.getWorldPosition(w.position.clone()).project(c).toArray();
   return {head,minimumClearance,vertices,buttonGap,buttonVertices,buttonScreen,telemetry:w.telemetry,backend:g.renderer.webgl.backend.constructor.name};
  },{pitch,crouch,working});results.push({name,...data});await page.screenshot({path:`${out}/${name}.png`});
 }
 await writeFile(`${out}/report.json`,JSON.stringify({results,errors},null,2));
 for(const r of results){
  assert(r.head.length>0);assert(r.head.every(h=>h.visible&&h.cast&&h.materials.every(m=>!m.color&&!m.depth)),'Head must cast shadows without obscuring first-person colour/depth');
  assert(r.telemetry.fingerFit.thumbR.angles[3]<=20.06,'Thumb IP joint overbent');
  assert(r.vertices>0);assert(r.minimumClearance>-.0005,`${r.name}: thumb penetrates can by ${-r.minimumClearance} m`);
  assert(r.minimumClearance<.004,`${r.name}: thumb is floating off can`);
  assert(r.telemetry.fingerFit.indexR.error<.006,`${r.name}: index missed button target`);
  assert(r.buttonVertices>0,`${r.name}: index does not overlap button`);
  assert(r.buttonGap>-.0005&&r.buttonGap<.002,`${r.name}: index pad gap ${r.buttonGap} m`);
  assert(r.telemetry.fingerFit.sprayForward.dot>.98,`${r.name}: index points across the actuator`);
  assert(r.telemetry.fingerFit.sprayForward.wristBendDegrees<25.1,`${r.name}: wrist overbent`);
  assert(Math.abs(r.buttonScreen[0])<.95&&Math.abs(r.buttonScreen[1])<.95,`${r.name}: actuator outside the useful first-person view`);
 }
 assert.deepEqual(errors,[]);console.log({backend,passed:true,cases:results.length});
}finally{await browser.close();}
