import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';
const oblique=process.argv.includes('--oblique');const out=oblique?'output/mortar-masonry-oblique':'output/mortar-masonry-volume';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await blockPointerLock(page.context());
 await page.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=array=>{if(array instanceof Uint32Array&&array.length===1){array[0]=193187;return array;}return original(array);};});
 await page.goto('http://127.0.0.1:5362/Electrical-Game/?waterPro=0',{waitUntil:'networkidle'});
 await page.locator('#start-button').click();await page.evaluate(()=>document.exitPointerLock());
 const excavation=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,w=g.room.brickWall,c=g.renderer.camera.clone(false),v=w.volume;
  const point=new g.mission.points[0].constructor({...g.mission.points[0].definition,id:'qa-single',x:.55,bottom:1.363,boxes:['1G']});
  point.position.set(.55,1.4,v.frontZ);point.boxGroup.visible=false;g.renderer.scene.add(point);
  const m=new g.mortar.constructor(g.renderer.scene,w,[point]);
  window.__mortarVolumeQA={g,w,c,v,point,m,loads:[]};
  const contact=w.contactProvider;w.contactProvider=null;let strikes=0;
  for(let pass=0;pass<25;pass++)for(let x=-.07;x<=.07+.0001;x+=.028)for(let y=-.07;y<=.07+.0001;y+=.028){
   c.position.set(.55+x,1.4+y,v.frontZ+.6);c.lookAt(.55+x,1.4+y,v.frontZ);c.updateMatrixWorld(true);
   const hit=v.raycast(c.position,c.getWorldDirection(c.position.clone().set(0,0,0)),1);
   if(hit&&v.frontZ-hit.point.z<.050){w.removeAtAim(c);strikes++;}
  }
  w.contactProvider=contact;while(v.pendingSupportCount)w.processPendingSupport();await w.waitForGeometry();
  point.boxGroup.visible=true;point.stage='fitted';point.updateWorldMatrix(true,true);
  return{strikes,removedNodes:v.removedNodeCount,frontZ:v.frontZ,boxDepth:point.boxGroup.boxes[0].depth};
 });
 async function capture(name){const png=await page.evaluate(async()=>{const q=window.__mortarVolumeQA,g=q.g;await g.renderer.waitForFrame();g.renderer.prepareMaterials();const c=q.c;c.position.set(.55+.17,1.45,q.v.frontZ+.43);c.lookAt(.55,1.4,q.v.frontZ-.035);c.fov=40;c.updateProjectionMatrix();c.updateMatrixWorld(true);g.renderer.webgl.render(g.renderer.scene,c);return g.renderer.webgl.domElement.toDataURL('image/png');});await writeFile(`${out}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));}
 await capture('01-real-excavated-single');
 const targets=[[0,.063],[0,-.063],[-.063,0],[.063,0]],loads=[];
 // Rounded first bays expose more volume than the previous rectangular profile.
 // Keep adding finite scoops at the same four edges until the actual bed is ready.
 for(let load=0;load<12;load++){const[dx,dy]=targets[load%targets.length];loads.push(await page.evaluate(({dx,dy,oblique})=>{const q=window.__mortarVolumeQA,{m,c,v}=q;c.position.set(.55+dx,1.4+dy,v.frontZ+.4);c.lookAt(.55+dx,1.4+dy,v.frontZ-.06);c.updateMatrixWorld(true);let hit=m.contact(c.position,c.getWorldDirection(c.position.clone().set(0,0,0)),.9);if(hit)m.applyWater(hit.point,hit.normal,.035);const before=m.launchedMass;let castReleased=false;
 if(oblique&&hit){const origin=hit.point.clone().set(.55+dx+(dx?Math.sign(dx)*.08:0),1.4+dy+(dy?Math.sign(dy)*.08:0),v.frontZ+.4),time=.18,velocity=hit.point.clone().sub(origin).multiplyScalar(1/time);velocity.y+=4.905*time;m.launch(origin,velocity,.65);castReleased=true;}else {const origin=c.position.clone().addScaledVector(c.getWorldDirection(c.position.clone().set(0,0,0)),.17);m.swing(true,.475,c,origin);m.swing(false,0,c,origin);m.swing(false,.16,c,()=>origin);castReleased=m.launchedMass>before;}
 for(let i=0;i<100;i++)m.update(.01);return{castReleased,launchedKg:m.launchedMass-before,hit:hit?{point:{...hit.point},normal:{...hit.normal}}:null,coverage:m.coverage(q.point),telemetry:m.telemetry};},{dx,dy,oblique}));if(load>=3&&await page.evaluate(()=>window.__mortarVolumeQA.m.ready(window.__mortarVolumeQA.point)))break;}
 await page.evaluate(()=>{for(let i=0;i<200;i++)window.__mortarVolumeQA.m.update(.01);});await capture('02-stacked-loads-continuous');
 for(const load of loads){assert(load.castReleased,'Finite cast did not release');assert(Math.abs(load.launchedKg-.65)<1e-8,'Cast mass differs from one scoop');}
 const final=await page.evaluate(()=>{const q=window.__mortarVolumeQA;return{coverage:q.m.coverage(q.point),ready:q.m.ready(q.point),telemetry:q.m.telemetry,geometry:q.m.deposits.map(d=>({vertices:d.mesh.geometry.getAttribute('position').count,bounds:d.mesh.geometry.boundingSphere,identity:d.mesh.position.lengthSq()===0}))};});
 await writeFile(`${out}/before-wash-report.json`,JSON.stringify({oblique,excavation,loads,final,errors},null,2));
 assert(final.ready,'Repeated finite loads must fill the actual rounded masonry bed');
 const wash=await page.evaluate(()=>{const q=window.__mortarVolumeQA,{m,c,v}=q;m.field.tick(360);for(const d of m.deposits)d.age+=360;const before=m.field.mass;let litres=0;
  for(let i=0;i<120;i++){c.position.set(.613,1.4,v.frontZ+.4);c.lookAt(.613,1.4,v.frontZ-.06);c.updateMatrixWorld(true);const hit=m.contact(c.position,c.getWorldDirection(c.position.clone().set(0,0,0)),.9);if(hit){m.applyWater(hit.point,hit.normal,.02);litres+=.02;}m.update(.06);}
  for(let i=0;i<200;i++)m.update(.01);return{beforeKg:before,afterKg:m.field.mass,litres,ready:m.ready(q.point),coverage:m.coverage(q.point),telemetry:m.telemetry};});
 await capture('03-six-minute-mortar-washout');
 assert(wash.afterKg<wash.beforeKg-.04,'Water failed to remove actual masonry mortar after six minutes');
 const mass=wash.telemetry;assert(Math.abs(mass.launchedKg-mass.stuckKg-mass.restingKg-mass.floorKg-mass.movingKg)<1e-7,'Actual masonry mortar mass imbalance');
 const report={application:oblique?'repeated oblique ballistic launches':'repeated delayed ballistic casts',fixture:'Production hollow MasonryVolume excavated with real impact API and production ElectricalBox. Camera/fixture placement and direct public application API are diagnostic, not normal-control gameplay proof.',excavation,loads,final,wash,errors};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({application:report.application,loads:loads.length,coverage:final.coverage,wash,errors},null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();}
