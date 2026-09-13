import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out='output/masonry-acceptance'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
await page.goto(base); await page.waitForFunction(()=>window.__wireTheHouse);
const checks=await page.evaluate(async()=>{
  const {MasonryVolume}=await import(new URL('src/world/MasonryVolume.ts',location.href).href);
  const failures=[];const check=(ok,message)=>{if(!ok)failures.push(message);};
  const opts={seed:193187};
  const shot=(v,x,y,chisel='flat',energyJ=4)=>{const h=v.raycast({x,y,z:-2},{x:0,y:0,z:-1},.8);return h?v.impact({point:h.point,direction:{x:0,y:0,z:-1},edge:{x:1,y:0,z:0},energyJ,chisel}):null;};
  const edited=v=>v.serialize().chunks.flatMap(c=>c.edits.filter(e=>e[2]).map(([i])=>{const [tx,ty]=c.key.split(',').map(Number),z=i%(v.nz+2),xy=Math.floor(i/(v.nz+2));return v.nodePosition(tx*v.tileSize+xy%v.tileSize,ty*v.tileSize+Math.floor(xy/v.tileSize),z);}));
  const v=new MasonryVolume(opts),x=.8,y=1.55,progress=[];
  const rearBefore=v.sampleMaterial(x,y,-2.582);
  for(let i=0;i<16;i++){const r=shot(v,x,y);progress.push({nodes:r?.removedNodes??0,total:v.removedNodeCount,depth:r?.contact?(-2.41-r.contact.point.z)*1000:null,materials:r?.removedByMaterial??{},detached:r?.stats.detachedNodes??0});if(i===0)check(v.sampleMaterial(x,y,-2.582)===rearBefore,'First contact tunneled through empty chamber to rear shell');}
  check(progress.some(p=>p.nodes>0),'No real material removed');check(progress.some(p=>p.depth>20),'Did not expose depth beyond front shell');
  check(progress.every((p,i)=>i===0||p.total>=progress[i-1].total),'Damage reverted');
  check(edited(v).every(p=>Math.abs(p.x-x)<.2&&Math.abs(p.y-y)<.2),'A local strike changed remote wall');
  const boundary=new MasonryVolume(opts); const boundaryImpacts=[]; for(let i=0;i<16;i++)boundaryImpacts.push(shot(boundary,0,1.5));
  check(boundaryImpacts.some(r=>r?.removedByMaterial.clay>0&&r?.removedByMaterial.mortar>0&&r.bounds.min.x<-.007&&r.bounds.max.x>.007),'No single strike partially removed both neighboring clay bodies and mortar together');
  const b=edited(boundary); check(b.some(p=>p.x<-.007)&&b.some(p=>p.x>.007),'Boundary field did not partially reach both units');
  check(b.some(p=>{const n=boundary.coordinates(p);return boundary.baseMaterial(n.x,n.y,n.z)===2;}),'Boundary field did not remove mortar');
  const freshA=new MasonryVolume(),freshB=new MasonryVolume();for(let i=0;i<6;i++){shot(freshA,x,y);shot(freshB,x,y);}
  check(freshA.seed!==freshB.seed,'Fresh wall seeds identical');check(JSON.stringify(edited(freshA))!==JSON.stringify(edited(freshB)),'Fresh fractures have identical fine topology');
  const replay=new MasonryVolume(opts);for(let i=0;i<16;i++)shot(replay,x,y);check(JSON.stringify(v.serialize())===JSON.stringify(replay.serialize()),'Same seed/input is not replayable');
  const restored=new MasonryVolume(opts);restored.restore(v.serialize());check(JSON.stringify(restored.serialize())===JSON.stringify(v.serialize()),'Serialized permanent damage/weakness failed roundtrip');
  const concrete=new MasonryVolume({...opts,material:'concrete'}),render=new MasonryVolume({...opts,renderThickness:.016}),clay=new MasonryVolume(opts);
  let con=0,ren=0,cla=0;for(let i=0;i<4;i++){con+=shot(concrete,x,y)?.removedNodes??0;ren+=shot(render,x,y)?.removedNodes??0;cla+=shot(clay,x,y)?.removedNodes??0;}
  check(con<cla,'Concrete is not substantially more resistant than clay');check(ren>cla,'Render does not chip more readily than clay');
  const materialResponse={concrete:con,render:ren,clay:cla};
  const partialRibs=[]; for(let i=0;i<40;i++){const xx=.70+i*.004;partialRibs.push({x:xx,front:v.sampleMaterial(xx,y,-2.414),rib:v.sampleMaterial(xx,y,-2.47),rear:v.sampleMaterial(xx,y,-2.582)});}
  check(partialRibs.some(p=>p.rib===1)&&partialRibs.some(p=>p.rib===0),'No mixture of broken and surviving internal rib material');
  return {failures,progress,boundaryRemoved:b.length,materialResponse,partialRibs,randomSeeds:[freshA.seed,freshB.seed],memoryBytes:v.memoryBytes};
});
await writeFile(`${out}/logic.json`,JSON.stringify(checks,null,2));console.log(JSON.stringify({failures:checks.failures,boundaryRemoved:checks.boundaryRemoved,materialResponse:checks.materialResponse,randomSeeds:checks.randomSeeds}));
await page.click('#start-button');await page.keyboard.press('Digit4');
await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.set(.8,1.65,-1.59);g.renderer.camera.lookAt(.8,1.3,-2.41);g.player.yaw=g.renderer.camera.rotation.y;g.player.pitch=g.renderer.camera.rotation.x;g.step(1/60);});
for(let i=0;i<12;i++){await page.keyboard.press('KeyE');await page.waitForTimeout(100);if([0,3,7,11].includes(i))await page.screenshot({path:`${out}/center-${i+1}.png`});}
// A chisel-controlled vertical/horizontal chase: camera aiming is a fixture,
// every strike is a keyboard action consumed by the normal gameplay Input.
for(let pass=0;pass<5;pass++)for(let i=0;i<24;i++){
 await page.evaluate(({i,pass})=>{const g=window.__wireTheHouse;const x=-.7+(pass%2)*.018,y=.7+i*.025;g.player.crouched=y<1.05;g.renderer.camera.position.set(x,g.player.eyeHeight,-1.59);g.renderer.camera.lookAt(x,y,-2.41);g.player.yaw=g.renderer.camera.rotation.y;g.player.pitch=g.renderer.camera.rotation.x;g.step(1/60);},{i,pass});
 await page.keyboard.press('KeyE'); await page.waitForTimeout(20);
}
for(let pass=0;pass<4;pass++)for(let i=0;i<20;i++){
 await page.evaluate(({i,pass})=>{const g=window.__wireTheHouse;const x=-.6+i*.025,y=1.15+(pass%2)*.016;g.player.crouched=y<1.05;g.renderer.camera.position.set(x,g.player.eyeHeight,-1.59);g.renderer.camera.lookAt(x,y,-2.41);g.player.yaw=g.renderer.camera.rotation.y;g.player.pitch=g.renderer.camera.rotation.x;g.step(1/60);},{i,pass});
 await page.keyboard.press('KeyE');await page.waitForTimeout(20);
}
await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.set(-.3,1.65,-1.59);g.renderer.camera.lookAt(-.3,1.1,-2.41);g.player.yaw=g.renderer.camera.rotation.y;g.player.pitch=g.renderer.camera.rotation.x;g.step(1/60);});
await page.evaluate(async()=>{await window.__wireTheHouse.room.brickWall.waitForGeometry();});
await page.screenshot({path:`${out}/chase-tool.png`});
await page.evaluate(()=>{const g=window.__wireTheHouse;g.fpsRig.visible=false;g.renderer.render();});await page.screenshot({path:`${out}/chase-clear.png`});
await page.waitForTimeout(15000);
const runtime=await page.evaluate(()=>({state:JSON.parse(window.render_game_to_text()),triangles:window.__wireTheHouse.renderer.webgl.info.render.triangles,geometries:window.__wireTheHouse.renderer.webgl.info.memory.geometries,overflow:document.documentElement.scrollWidth>innerWidth}));
await writeFile(`${out}/runtime.json`,JSON.stringify({runtime,errors},null,2));
assert.equal(errors.length,0,errors.join('\n'));assert.equal(runtime.overflow,false);assert.equal(runtime.state.workSurface.deformedWallCells,0);
assert.deepEqual(checks.failures,[]);console.log('Masonry geometry, seed, material, locality, persistence and browser chase PASS');
} finally {await browser.close();}
