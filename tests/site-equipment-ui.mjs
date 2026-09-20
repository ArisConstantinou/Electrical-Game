import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
const before=process.argv.includes('--before'),out=`output/site-equipment-${before?'before':'after'}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={errors:[],backend:'WebGL',viewport:'1440x900',pointerLock:'blocked'};
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});await blockPointerLock(page.context());await page.routeWebSocket('**',()=>{});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse);
 await page.locator('#start-button').click();await page.waitForTimeout(650);
 const camera=async(position,target)=>page.evaluate(({position,target})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(...position);c.lookAt(...target);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;}, {position,target});
 const shot=async name=>{await page.waitForTimeout(200);await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});};
 await camera([-2.9,1.65,-1.1],[-.3,.55,1.8]);await shot('bay');
 report.performance=await page.evaluate(async()=>{const times=[];let last=performance.now();for(let i=0;i<150;i++){await new Promise(requestAnimationFrame);const t=performance.now();if(i>20)times.push(t-last);last=t;}times.sort((a,b)=>a-b);const r=window.__wireTheHouse.renderer;return{meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),render:r.webgl.info.render,memory:r.webgl.info.memory};});
 if(!before){
  report.initial=await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry);
  assert.equal(report.initial.wheelbarrow.massKg,report.initial.wheelbarrow.capacityKg);
  assert.equal(report.initial.batch.waterLitres,0);
  report.layout=await page.evaluate(async()=>{const T=await import('/Electrical-Game/node_modules/three/build/three.module.js'),m=window.__wireTheHouse.mixing.models;
   const aisle=new T.Box3(new T.Vector3(-.68,0,-.60),new T.Vector3(.68,2,1.70));
   const roots=[m.wheelbarrow.group,m.concreteMixer,m.bucket,m.mixer,m.sand,m.shovel,...m.sacks,m.water,m.rinse];
   const bounds=roots.map(o=>{const b=new T.Box3().setFromObject(o);return{name:o.name,min:b.min.toArray(),max:b.max.toArray(),blocksAisle:b.intersectsBox(aisle)};});
   return{aisleWidthM:1.36,aisleLengthM:2.30,bounds};});
  assert(report.layout.bounds.every(b=>!b.blocksAisle),'Equipment obstructs the central wheelbarrow aisle');
  await camera([0,1.65,-1.25],[0,.55,2.20]);await shot('open-horseshoe');
  await camera([-2.72,1.48,-.75],[-.91,.58,.20]);await page.keyboard.press('Digit7');await shot('loaded-trowel');
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.fpsRig.tools.get('trowel').getObjectByName('trowel-load').visible),true);
  await page.keyboard.press('Digit3');await camera([-2.32,1.48,-.68],[-.73,.51,.50]);await shot('wheelbarrow');
  await camera([-1.15,1.47,1.0],[-.55,.83,2.83]);await shot('drum-mixer');
  await camera([.55,1.45,1.05],[-.55,.88,2.70]);await shot('drum-mixer-front');
  report.models=await page.evaluate(()=>{const g=window.__wireTheHouse,roots=[g.mixing.models.wheelbarrow.group,g.mixing.models.concreteMixer];return roots.map(root=>{let triangles=0,meshes=0;const bad=[];root.traverse(o=>{if(!o.isMesh)return;meshes++;const p=o.geometry.getAttribute('position'),n=o.geometry.getAttribute('normal');if(!Array.from(p.array).every(Number.isFinite)||n&&!Array.from(n.array).every(Number.isFinite))bad.push(o.name);triangles+=(o.geometry.index?.count??p.count)/3*(o.isInstancedMesh?o.count:1);});return{name:root.name,triangles,meshes,bad};});});
  assert(report.models.every(m=>m.bad.length===0),'Geometry positions/normals must remain finite');
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.equipmentStep=g.step.bind(g);g.step=()=>{};});
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.equipmentStep(1/60);},n);
  await camera([-.9,1.65,-1.55],[-.9,1.35,-2.41]);await page.keyboard.press('Digit7');await step(5);
  // Native input: a cancelled windup uses nothing; three subsequent casts each
  // consume one 650 g scoop without any preparation fixture.
  await page.keyboard.down('KeyE');await step(12);await page.keyboard.press('Digit3');await page.keyboard.up('KeyE');await step(5);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry.wheelbarrow.massKg),114);
  await page.keyboard.press('Digit7');await step(3);report.throws=[];
  for(let i=0;i<3;i++){await page.keyboard.down('KeyE');await step(28);await page.keyboard.up('KeyE');await step(110);report.throws.push(await page.evaluate(()=>({supply:window.__wireTheHouse.mixing.telemetry.wheelbarrow.massKg,launched:window.__wireTheHouse.mortar.launchedMass,load:window.__wireTheHouse.fpsRig.tools.get('trowel').getObjectByName('trowel-load').visible})));assert(Math.abs(report.throws[i].supply-(114-.65*(i+1)))<1e-7);assert(Math.abs(report.throws[i].launched-.65*(i+1))<1e-7);assert(report.throws[i].load);}
  await shot('three-casts');
  await prepareFinishedMortar(page);report.preparedPriority=await page.evaluate(()=>{const m=window.__wireTheHouse.mixing,before=m.batch.massKg,barrow=m.telemetry.wheelbarrow.massKg,used=m.reserveScoop(.65);return{used,batchLoss:before-m.batch.massKg,barrowLoss:barrow-m.telemetry.wheelbarrow.massKg};});
  assert(Math.abs(report.preparedPriority.batchLoss-.65)<1e-7);assert.equal(report.preparedPriority.barrowLoss,0);
  await page.evaluate(()=>{const m=window.__wireTheHouse.mixing;m.batch.consumeKg(1e6);m.reserveScoop(m.telemetry.wheelbarrow.massKg-57);});
  await camera([-2.32,1.65,-.68],[-.73,.51,.50]);await step(2);await shot('half-full');
  report.depletion=await page.evaluate(()=>{const m=window.__wireTheHouse.mixing,remaining=m.telemetry.wheelbarrow.massKg,used=m.reserveScoop(1e6);return{remaining,used,available:m.canSupplyScoop,visible:m.models.wheelbarrow.mortar.visible,extra:m.reserveScoop(.65),invalid:m.reserveScoop(NaN)};});
  assert.equal(report.depletion.used,report.depletion.remaining);assert.equal(report.depletion.extra,0);assert.equal(report.depletion.invalid,0);assert.equal(report.depletion.available,false);assert.equal(report.depletion.visible,false);await step(2);await shot('empty-wheelbarrow');
  await page.reload();await page.waitForFunction(()=>window.__wireTheHouse);await page.locator('#start-button').click();await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry.wheelbarrow.massKg),114);
  // Same mobile camera/backend, alternating visible and absent equipment. This
  // isolates the two props' frame cost without comparing different machines.
  await page.setViewportSize({width:390,height:844});await camera([-2.9,1.65,-1.1],[-.3,.55,1.8]);
  report.mobilePerformance=[];
  for(const visible of [false,true,false,true]){
   report.mobilePerformance.push(await page.evaluate(async visible=>{const g=window.__wireTheHouse;g.mixing.models.wheelbarrow.group.visible=visible;g.mixing.models.concreteMixer.visible=visible;const samples=[];let last=performance.now();for(let i=0;i<160;i++){await new Promise(requestAnimationFrame);const t=performance.now();if(i>30)samples.push(t-last);last=t;}samples.sort((a,b)=>a-b);return{visible,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1),drawCalls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles};},visible));
  }
  await page.keyboard.press('Digit7');await shot('portrait');
  await page.setViewportSize({width:844,height:390});await camera([-2.9,1.65,-1.1],[-.3,.55,1.8]);await shot('landscape');
 }
 assert.deepEqual(report.errors,[]);
} finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({before,...report}));
