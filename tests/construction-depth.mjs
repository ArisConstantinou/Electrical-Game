import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {openEditorBrowser,openEditorDetails,saveEditorLevel} from './editor-navigation.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve(process.env.QA_DEPTH_OUTPUT??'output/construction-depth');await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
const result={errors:[],cases:[],physicalPhone:false};
await runManagedClient(session,240000,async()=>{
 const context=await session.browser.newContext({viewport:{width:1280,height:900}});await blockPointerLock(context);await routeBuildingDist(context);
 // Keep all save operations inside this owned browser, never in the user's sidecar.
 await context.route('**/__wire-house-mansion-level**',route=>route.fulfill({status:404,body:'Browser-local QA'}));
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.levelEditor?.active,null,{timeout:120000});
 result.initial=await page.evaluate(()=>{
  const g=window.__wireTheHouse,e=g.levelEditor,w=g.room.brickWall;
  const column=[...g.room.mansionWing.editableAssets.values()].find(a=>a.userData.levelEditorLabel==='Structural concrete column');
  const mesh=column.children.find(a=>a.isMesh);mesh.geometry.computeBoundingBox();const Box=mesh.geometry.boundingBox.constructor;
  const bounds=new Box().setFromObject(column),a=w.localToWorld(new w.position.constructor(0,0,w.volume.frontZ)),b=w.localToWorld(new w.position.constructor(0,0,w.volume.frontZ-w.volume.depth));
  e.setViewMode('3d');e.floorIndex=0;e.applyFloorVisibility();e.selectWall(column);
  // Same roof-hidden top inspection and camera in both versions.
  const ceiling=g.room.getObjectByName('Concrete slab ceiling');if(ceiling)ceiling.visible=false;
  e.orbit.target.set(-2.72,1.5,-2.46);e.camera.position.set(-2.72,4,-2.46);e.camera.up.set(0,0,-1);e.camera.lookAt(e.orbit.target);e.orbit.update();
  const columns=[...g.room.mansionWing.editableAssets.values()].filter(a=>a.userData.constructionColumnAxes).map(a=>({name:a.userData.levelEditorLabel,axes:a.userData.constructionColumnAxes,depths:a.userData.constructionColumnAxes.map(axis=>new Box().setFromObject(a).getSize(a.position.clone())[axis])}));
  const jambs=[];g.room.traverse(o=>{if(o.name==='Exposed concrete passage jamb'){const box=new Box().setFromObject(o),size=box.getSize(o.position.clone());jambs.push({width:size.x,depth:size.z,clearEdge:Math.min(Math.abs(box.min.x),Math.abs(box.max.x))});}});
  return {id:column.name,columnDepth:bounds.max.z-bounds.min.z,columnFront:bounds.max.z,columnBack:bounds.min.z,brickDepth:Math.abs(a.z-b.z),brickFront:a.z,brickBack:b.z,columns,jambs,wingDepths:[...g.room.mansionWing.editableWalls.values()].filter(a=>a.userData.levelEditorKind==='brick-wall').map(a=>.24*Math.abs(a.scale[a.userData.alongX?'z':'x']))};
 });
 await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'default-top.png')});await writeFile(path.join(out,'initial.json'),JSON.stringify(result.initial,null,2));
 const near=(a,b)=>assert(Math.abs(a-b)<.001,`${a} must equal ${b}`);
 near(result.initial.columnDepth,.15);near(result.initial.brickDepth,.10);near(result.initial.columnFront-result.initial.brickFront,.025);near(result.initial.brickBack-result.initial.columnBack,.025);assert(result.initial.wingDepths.every(d=>Math.abs(d-.1)<.001));result.cases.push('default-10cm-brick-15cm-column-both-2.5cm-projections');
 assert(result.initial.columns.length>50);for(const c of result.initial.columns)for(const d of c.depths)near(d,.15);result.cases.push('all-authored-columns-and-concrete-opening-supports');
 assert.equal(result.initial.jambs.length,2);for(const jamb of result.initial.jambs){near(jamb.width,.15);near(jamb.depth,.15);near(jamb.clearEdge,1.35);}result.cases.push('both-passage-jamb-normals-15cm-with-clear-opening-retained');
 result.workWall=await page.evaluate(()=>{
  const g=window.__wireTheHouse,w=g.room.brickWall,point=g.mission.points[0],camera=g.renderer.camera.clone(false),front=w.volume.frontZ;
  camera.position.set(.8,1.3,front+.5);camera.lookAt(.8,1.3,front);camera.updateMatrixWorld(true);
  const blocked=g.boxPlacement.assess(point,camera);
  w.volume.carveBox({x:.5,y:1.15,z:front-.058},{x:1.1,y:1.45,z:front+.002});
  const clear=g.boxPlacement.assess(point,camera),boundary=g.room.getObjectByName('Individual clay courses on courtyard boundary');boundary.geometry.computeBoundingBox();
  return {volumeDepth:w.volume.depth,practiceDepth:g.room.intactPracticeWall.volume.depth,worldScale:w.scale.z,boundaryDepth:boundary.geometry.boundingBox.getSize(w.position.clone()).x,blocked:blocked.canPlace,blockedReason:blocked.reason,clear:clear.canPlace,clearReason:clear.reason,proudDepthM:clear.proudDepthM};
 });
 near(result.workWall.volumeDepth,.1);near(result.workWall.practiceDepth,.1);near(result.workWall.worldScale,1);near(result.workWall.boundaryDepth,.1);assert.equal(result.workWall.blocked,false);assert.equal(result.workWall.blockedReason,'masonry');assert.equal(result.workWall.clear,true,JSON.stringify(result.workWall));result.cases.push('physical-10cm-work-wall-box-fit-refusal-and-clearance');
 await openEditorDetails(page);await page.locator('[data-size="z"]').fill('.24');await page.locator('[data-size="z"]').dispatchEvent('change');
 const edited=await page.evaluate(id=>{const a=window.__wireTheHouse.room.mansionWing.editableAssets.get(id);return a.userData.baseSize[2]*Math.abs(a.scale.z);},result.initial.id);near(edited,.24);result.cases.push('larger-column-option');
 await page.locator('#level-undo').click();near(await page.evaluate(id=>{const a=window.__wireTheHouse.room.mansionWing.editableAssets.get(id);return a.userData.baseSize[2]*Math.abs(a.scale.z);},result.initial.id),.15);await page.locator('#level-redo').click();
 await saveEditorLevel(page);await page.waitForFunction(()=>new URL(location.href).searchParams.has('level'));await page.reload();await page.waitForFunction(()=>window.__wireTheHouse?.levelEditor?.active,null,{timeout:120000});
 result.restored=await page.evaluate(id=>{const g=window.__wireTheHouse,a=g.room.mansionWing.editableAssets.get(id);g.room.mansionWing.obstaclesAt(0);const c=g.room.mansionWing.obstacles.find(o=>o.id===id);return {depth:a.userData.baseSize[2]*Math.abs(a.scale.z),colliderDepth:c.maxZ-c.minZ,wingDepths:[...g.room.mansionWing.editableWalls.values()].filter(a=>a.userData.levelEditorKind==='brick-wall').map(a=>.24*Math.abs(a.scale[a.userData.alongX?'z':'x']))};},result.initial.id);
 near(result.restored.depth,.24);near(result.restored.colliderDepth,.26);assert(result.restored.wingDepths.every(d=>Math.abs(d-.1)<.001));result.cases.push('undo-redo-save-reload-and-collision-with-existing-1cm-margin');
 result.legacy=await page.evaluate(id=>{
  const g=window.__wireTheHouse,e=g.levelEditor,wing=g.room.mansionWing,doc=e.document();
  for(const r of doc.assets){const a=wing.editableAssets.get(r.id);if(!a?.userData.constructionColumnAxes)continue;delete r.dimensions;r.scale=[1,1,1];r.position=[...a.userData.constructionLegacyPosition];}
  for(const r of doc.walls){delete r.thickness;if(r.kind==='brick-wall')r.scale[wing.editableWalls.get(r.id).userData.alongX?2:0]=1;}
  const column=wing.editableAssets.get(id);column.position.z=42; // Default migration must not reuse an edited position.
  e.applyDocument(doc);
  const defaultDepth=column.userData.baseSize[2]*Math.abs(column.scale.z),defaultZ=column.position.z;
  const custom=doc.assets.find(a=>a.id===id);custom.scale[2]=.5;custom.position[2]=-3;
  const wall=doc.walls.find(r=>r.kind==='brick-wall');wall.scale[wing.editableWalls.get(wall.id).userData.alongX?2:0]=.5;
  e.applyDocument(doc);
  const customDepth=column.userData.baseSize[2]*Math.abs(column.scale.z),customZ=column.position.z;
  const w=wing.editableWalls.get(wall.id),customWallDepth=.24*Math.abs(w.scale[w.userData.alongX?'z':'x']);
  const newDoc=e.document();e.applyDocument(newDoc);
  return {defaultDepth,defaultZ,customDepth,customZ,customWallDepth,roundtripDepth:column.userData.baseSize[2]*Math.abs(column.scale.z)};
 },result.initial.id);
 near(result.legacy.defaultDepth,.15);near(result.legacy.defaultZ,-2.46);near(result.legacy.customDepth,.19);near(result.legacy.customZ,-3);near(result.legacy.customWallDepth,.12);near(result.legacy.roundtripDepth,.19);result.cases.push('legacy-default-migration-and-custom-dimensions-retained');
 await page.setViewportSize({width:390,height:844});await page.evaluate(id=>window.__wireTheHouse.levelEditor.selectWall(window.__wireTheHouse.room.mansionWing.editableAssets.get(id)),result.initial.id);await openEditorDetails(page);await page.locator('[data-fields-tab="size"]').click();await page.locator('[data-size="z"]').fill('.21');await page.locator('[data-size="z"]').dispatchEvent('change');near(await page.evaluate(id=>{const a=window.__wireTheHouse.room.mansionWing.editableAssets.get(id);return a.userData.baseSize[2]*Math.abs(a.scale.z);},result.initial.id),.21);result.cases.push('mobile-viewport-column-depth-field');
 assert.deepEqual(result.errors,[]);result.passed=true;await context.close();
});
await writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,cases:result.cases,columns:result.initial.columns.length,walls:result.initial.wingDepths.length,legacy:result.legacy,errors:result.errors}));
