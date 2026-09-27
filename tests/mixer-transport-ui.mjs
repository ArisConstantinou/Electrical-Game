import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const before=process.argv.includes('--before'),backend=process.env.QA_BACKEND??'webgl';
const out=process.env.QA_OUTPUT??`output/mixer-transport-${before?'before':'after'}-${backend}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const url=new URL(process.env.QA_BASE??'http://127.0.0.1:5365/Electrical-Game/');
url.searchParams.set('mansion','preview');url.searchParams.set('renderer',backend);
const report={before,backend,url:url.href,errors:[],checks:[],views:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await blockPointerLock(page.context());await routeBuildingDist(page.context());
 await page.context().route('**/__wire-house-mansion-level**',r=>new URL(r.request().url()).searchParams.has('list')
  ?r.fulfill({json:{slots:[]}}):r.fulfill({status:404,body:'QA browser-local'}));
 await page.routeWebSocket('**',()=>{});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{
  // This fixture deliberately disables the local editor persistence endpoint;
  // retain its expected 404 separately from actual game/asset failures.
  if(m.type()!=='error')return;
  const entry={message:m.text(),url:m.location().url};
  if(entry.url.includes('/__wire-house-mansion-level')&&entry.message.includes('404')){
   (report.persistenceFixture??=[]).push(entry);return;
  }
  report.errors.push(entry);
 });
 await page.goto(url.href);
 report.servedModule=await page.locator('script[type="module"]').getAttribute('src');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
 await page.locator('#start-button').click();
 await page.waitForFunction(()=>window.__wireTheHouse.started);
 report.environment=await page.evaluate(()=>{
  const backend=window.__wireTheHouse.renderer.gpu.backend,gl=backend.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info');
  const info=backend.device?.adapterInfo??backend.adapter?.info;
  return{userAgent:navigator.userAgent,dpr:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,
   gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):info?{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:null};
 });
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,m=g.mixing.models.concreteMixer,c=g.renderer.camera;
  window.mixerTransportStep=g.step.bind(g);g.step=()=>{};
  m.updateWorldMatrix(true,true);
  c.position.copy(m.localToWorld(m.position.clone().set(1.75,1.5,-1.9)));
  c.lookAt(m.localToWorld(m.position.clone().set(0,.68,-.16)));
  g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;g.fpsRig.visible=false;
 });
 report.assembly=await page.evaluate(()=>{
  const g=window.__wireTheHouse,m=g.mixing.models.concreteMixer;
  const local=o=>m.worldToLocal(o.getWorldPosition(o.position.clone()));
  const axis=o=>o.position.clone().set(0,1,0).applyQuaternion(o.quaternion);
  const sand=g.mixing.models.sand;sand.updateWorldMatrix(true,false);
  const wheels=['left-transport-wheel','right-transport-wheel'].map(name=>{
   const w=m.getObjectByName(name),centre=local(w),normal=axis(w),rubber=w.getObjectByName(`${name}-rubber-carcass`);
   rubber.geometry.computeBoundingBox();const radius=rubber.geometry.boundingBox.max.x;
   const p=rubber.geometry.getAttribute('position');let sandClearanceM=Infinity;
   for(let i=0;i<p.count;i++){
    const v=w.position.clone().fromBufferAttribute(p,i).applyMatrix4(rubber.matrixWorld);
    sand.worldToLocal(v);sandClearanceM=Math.min(sandClearanceM,v.y-Math.max(0,sand.heightAt(v.x,v.z)-.004));
   }
   return{name,centre:centre.toArray(),normal:normal.toArray(),radiusM:radius,groundGapM:centre.y-radius,sandClearanceM};
  });
  const axle=m.getObjectByName('axle-crossmember'),mid=local(axle),direction=axis(axle),half=axle.geometry.parameters.height/2;
  const ends=[-1,1].map(s=>mid.clone().addScaledVector(direction,s*half));
  const legEnds=[];m.traverse(o=>{if(o.name.startsWith('rear-tripod-leg-')){
   const p=local(o),v=axis(o),half=o.geometry.parameters.height/2;
   legEnds.push(p.addScaledVector(v,half).toArray());
  }});
  let meshes=0,triangles=0;const bad=[];
  m.traverse(o=>{if(!o.isMesh)return;meshes++;const p=o.geometry.getAttribute('position');
   triangles+=(o.geometry.index?.count??p.count)/3*(o.isInstancedMesh?o.count:1);
   if(!Array.from(p.array).every(Number.isFinite))bad.push(o.name);
  });
  return{wheels,axleEnds:ends.map(p=>p.toArray()),axleDirection:direction.toArray(),legEnds,
   wheelbarrowAxis:axis(g.mixing.models.wheelbarrow.group.getObjectByName('single-pneumatic-wheel')).toArray(),
   mixerObstacle:g.mixing.collisionObstacles().find(o=>o.id==='concrete-mixer'),sandMassKg:sand.remainingKg,meshes,triangles,bad};
 });
 const a=report.assembly,near=(p,q,t=1e-6)=>Math.hypot(...p.map((v,i)=>v-q[i]))<t;
 report.checks.push({name:'Axle crosses the frame beneath the motor',passed:a.wheels.every(w=>Math.abs(w.centre[0]-.40)<1e-6)&&Math.abs(a.axleDirection[2])>.999});
 report.checks.push({name:'Both tyre normals follow the axle',passed:a.wheels.every(w=>Math.abs(w.normal[2])>.999)});
 report.checks.push({name:'Tripod legs meet the axle ends',passed:a.legEnds.every(p=>a.axleEnds.some(q=>near(p,q)))});
 report.checks.push({name:'Axle reaches both wheel hubs',passed:a.wheels.every(w=>a.axleEnds.some(q=>near(w.centre,q,.041)))});
 report.checks.push({name:'Wheel size and ground contact preserved',passed:a.wheels.every(w=>Math.abs(w.radiusM-.166)<1e-6&&Math.abs(w.groundGapM-.004)<1e-6)});
 report.checks.push({name:'Wheelbarrow axle remains along X',passed:Math.abs(a.wheelbarrowAxis[0])>.999});
 report.checks.push({name:'Finite geometry',passed:a.bad.length===0});
 report.checks.push({name:'Tyres do not intersect the sand pile',passed:a.wheels.every(w=>w.sandClearanceM>=-1e-6)});
 report.checks.push({name:'Mixer leaves the mansion doorway centre clear',passed:a.mixerObstacle.maxX<-.55});
 for(const [name,width,height] of [['desktop',1440,900],['portrait',390,844],['landscape',844,390]]){
  await page.setViewportSize({width,height});
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
  await page.screenshot({path:`${out}/${name}.png`});
  report.views.push({name,width,height});
 }
 await page.setViewportSize({width:1440,height:900});
 report.performance=await page.evaluate(async()=>{
  const samples=[];let last=performance.now();for(let i=0;i<160;i++){
   await new Promise(requestAnimationFrame);const r=window.__wireTheHouse.renderer;
   await r.waitForFrame();r.render();await r.waitForFrame();
   const now=performance.now();if(i>=30)samples.push(now-last);last=now;
  }samples.sort((a,b)=>a-b);
  const r=window.__wireTheHouse.renderer,info=r.webgl?.info??r.webgpu?.info;
  return{meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),render:info?.render.drawCalls?info.render:null,memory:info?.memory};
 });
 report.drum=await page.evaluate(()=>{
  const g=window.__wireTheHouse,d=g.mixing.drum,w=g.mixing.models.concreteMixer.getObjectByName('left-transport-wheel');
  const before=d.telemetry.angle,wheel=w.quaternion.toArray(),mass=g.mixing.telemetry.wheelbarrow.massKg;
  d.toggle();d.update(.25);const after=d.telemetry.angle;d.toggle();
  return{before,after,wheelStayedFixed:wheel.every((v,i)=>v===w.quaternion.toArray()[i]),massBefore:mass,massAfter:g.mixing.telemetry.wheelbarrow.massKg,running:d.telemetry.running};
 });
 report.checks.push({name:'Drum starts and stops independently of transport wheels',passed:report.drum.after>report.drum.before&&report.drum.wheelStayedFixed&&!report.drum.running&&report.drum.massAfter===report.drum.massBefore});
 assert.deepEqual(report.errors,[]);
 if(!before)for(const c of report.checks)assert(c.passed,c.name);
 else assert(report.checks.slice(0,2).every(c=>!c.passed),'Baseline must reproduce the incorrect assembly orientation');
} finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
