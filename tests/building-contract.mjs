import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const out='output/building-contract';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 result.uv=await page.evaluate(()=>{
  const g=window.__wireTheHouse,errors=[];let meshes=0,edges=0;
  g.room.updateMatrixWorld(true);
  g.room.traverse(o=>{
   const tile=o.userData.constructionUVTileMeters;if(!tile)return;meshes++;
   const p=o.geometry.attributes.position,n=o.geometry.attributes.normal,uv=o.geometry.attributes.uv,idx=o.geometry.index;
   const a=g.renderer.camera.position.clone(),b=a.clone(),normal=a.clone();
   const count=idx?idx.count:p.count;
   for(let i=0;i<count;i+=3){
    const ia=idx?idx.getX(i):i,ib=idx?idx.getX(i+1):i+1;
    normal.fromBufferAttribute(n,ia).transformDirection(o.matrixWorld);
    if(Math.max(Math.abs(normal.x),Math.abs(normal.y),Math.abs(normal.z))<.999)continue;
    const nb=normal.clone().fromBufferAttribute(n,ib).transformDirection(o.matrixWorld);if(normal.dot(nb)<.9999)continue;
    a.fromBufferAttribute(p,ia).applyMatrix4(o.matrixWorld);b.fromBufferAttribute(p,ib).applyMatrix4(o.matrixWorld);
    const length=a.distanceTo(b),mapped=Math.hypot(uv.getX(ia)-uv.getX(ib),uv.getY(ia)-uv.getY(ib))*tile;
    if(length>.02){edges++;if(Math.abs(mapped-length)>.0001)errors.push({name:o.name,length,mapped});}
   }
  });return {meshes,edges,errors:errors.slice(0,20)};
 });
 assert(result.uv.meshes>100&&result.uv.edges>1000);assert.deepEqual(result.uv.errors,[]);
 result.masonry=await page.evaluate(()=>{
  const g=window.__wireTheHouse,wing=g.room.mansionWing,cam=g.renderer.camera.clone(),failures=[];let tested=0;
  wing.restoreGameplayVisibility();
  for(const [name,wall] of wing.masonryDemolition){
   wall.group.updateWorldMatrix(true,true);
   const height=wall.group.userData.height??3;
   const center=cam.position.clone().set(0,height*.5,0),alongX=wall.group.userData.alongX??wall.alongX;
   const eye=center.clone();if(alongX)eye.z=.8;else eye.x=.8;
   cam.position.copy(wall.group.localToWorld(eye));cam.lookAt(wall.group.localToWorld(center));cam.updateMatrixWorld(true);
   if(!wall.aim(cam))failures.push(name);tested++;
  }
  return {tested,failures};
 });
 assert.deepEqual(result.masonry.failures,[]);
 result.windowOpening=await page.evaluate(()=>{
  const wing=window.__wireTheHouse.room.mansionWing;
  const asset=[...wing.editableAssets.values()].find(a=>a.userData.levelEditorLabel?.startsWith('Courtyard east window sill assembly 8'));
  const wall=wing.masonryDemolition.get('Courtyard east window sill masonry 8');
  const contains=()=>wing.obstaclesAt(0).some(o=>o.id===wall.obstacle.id&&Number.isFinite(o.minX));
  const before=contains();wing.setEditorAssetHidden(asset,true);const hidden=contains();wing.setEditorAssetHidden(asset,false);const restored=contains();
  return {before,hidden,restored};
 });
 assert.deepEqual(result.windowOpening,{before:true,hidden:false,restored:true});
 await page.locator('#site-pro-desktop-tools [data-tool="hammer"]').click();
 result.work=[];
 for(const name of ['Original room right practice masonry','Original room west wall before window','Original room rear east infill','L2 west wing room entrance north pier','L1 east wing north return','B1 unfinished workshop partition south']){
  const before=await page.evaluate(name=>{
   const g=window.__wireTheHouse,wall=g.room.mansionWing.masonryDemolition.get(name),cam=g.player.camera;
   const center=cam.position.clone().set(0,1.65,0),eye=center.clone();if(wall.alongX)eye.z=-1;else eye.x=name==='Original room right practice masonry'?-1:1;
   wall.group.updateWorldMatrix(true,true);cam.position.copy(wall.group.localToWorld(eye));cam.lookAt(wall.group.localToWorld(center));g.player.yaw=cam.rotation.y;g.player.pitch=cam.rotation.x;
   g.hammerMode='chase';g.lastHammerMasonryAim=null;g.failedHammerMasonry=null;g.player.wallWorkEnabled=false;
   return wall.removedClayNodes;
  },name);
  await page.mouse.move(683,384);await page.mouse.down();await page.waitForTimeout(1200);await page.mouse.up();
  const work=await page.evaluate(name=>{const g=window.__wireTheHouse,w=g.room.mansionWing.masonryDemolition.get(name);return {name,nodes:w.removedClayNodes,partial:w.partialDamageCount,contact:g.fpsRig.contactStatus,position:g.player.camera.position.toArray()};},name);
  result.work.push(work);assert(work.nodes>before,JSON.stringify(work));
 }
 await page.screenshot({path:`${out}/worked-wall.png`});
 result.save=await page.evaluate(()=>{const g=window.__wireTheHouse,w=g.room.mansionWing;const document=g.levelEditor.document(),before=[...w.masonryDemolition].reduce((n,[,wall])=>n+wall.removedClayNodes,0);w.restoreDemolition({});g.levelEditor.applyDocument(document);return {before,after:[...w.masonryDemolition].reduce((n,[,wall])=>n+wall.removedClayNodes,0),walls:Object.keys(document.masonryDamage??{}).length};});
 assert(result.save.before>0);assert.equal(result.save.before,result.save.after);assert.deepEqual(result.errors,[]);result.passed=true;
 console.log(JSON.stringify(result));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(result,null,2));await browser.close();}
