import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const baseline=process.argv.includes('--baseline');
const out=process.env.REBAR_QA_OUTPUT??`output/rebar-pliers-wire/${baseline?'before':'after'}`;
const url='http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
await mkdir(out,{recursive:true});
const report={baseline,url,physicalPhone:false,errors:[],cases:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const viewport of [{width:1366,height:768},{width:390,height:844},{width:844,height:390}].filter(v=>!process.argv.includes('--desktop-only')||v.width===1366)) {
  const mobile=viewport.width!==1366,name=mobile?(viewport.width===390?'portrait':'landscape'):'desktop';
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
  await blockPointerLock(context);await serveTaskBuild(context,url);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
  await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
  // Same genuinely cut pipe fixture as fitted-drilling acceptance. Full stock
  // production/cutting are covered separately by manual-pvc-ui.mjs.
  await page.evaluate(async()=>{
   const g=window.__wireTheHouse,p=g.pvc;await g.workerBody.ready;window.rebarTick=g.step.bind(g);g.step=()=>{};
   p.bend.angles.fill(90/8,0,8);p.bend.revision++;p.bend.grip=7;p.target=g.mission.points[0];
   const pos=p.target.boxGroup.getWorldPosition(g.renderer.camera.position.clone());
   p.cutFrom=p.cutS=p.bend.topHeight-(pos.y-p.target.boxGroup.groupHeight/2+.015);
   const mesh=new p.pipe.constructor();mesh.update(p.bend,p.cutFrom);p.rawCount--;
   p.carried={mesh,recipe:p.bend.recipe(),cutFrom:p.cutFrom,bundle:0,originBundle:0};
   p.transition('cut');p.setFocus();for(let i=0;i<80;i++)window.rebarTick(1/60);
   window.rebarSkinGap=()=>{
    const body=g.workerBody,V=g.renderer.camera.position.constructor,edges=[];
    p.rebarPliers.traverse(o=>{if(o.isMesh&&/Polished bevel/.test(o.name)){o.geometry.computeBoundingBox();edges.push(o);}});
    if(!edges.length)return Infinity;
    p.work.updateMatrixWorld(true);const leftBones=new Set(['hand',...['index','middle','ring','little','thumb'].flatMap(d=>[1,2,3].map(j=>d+'.0'+j))].map(name=>body.bone(name+'.L')));let gap=Infinity;
    const minimum=new V(Infinity,Infinity,Infinity),maximum=new V(-Infinity,-Infinity,-Infinity);
    body.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
     for(let i=0;i<indices.count;i++){let weight=0;for(let j=0;j<4;j++)if(leftBones.has(mesh.skeleton.bones[indices.getComponent(i,j)]))weight+=weights.getComponent(i,j);if(weight<.75)continue;
      const world=mesh.localToWorld(mesh.getVertexPosition(i,new V()));minimum.min(world);maximum.max(world);for(const edge of edges){const point=edge.worldToLocal(world.clone()),box=edge.geometry.boundingBox;gap=Math.min(gap,point.distanceTo(point.clone().clamp(box.min,box.max)));}
     }
    });window.rebarLeftSkinBounds={minimum:minimum.toArray(),maximum:maximum.toArray()};return gap;
   };
  });
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++){window.rebarTick(1/60);if(window.__wireTheHouse.pvc.phase==='fastener-tightening')window.rebarMinimumSkinGap=Math.min(window.rebarMinimumSkinGap??Infinity,window.rebarSkinGap());}},n);
  const use=async()=>{if(mobile)await page.locator('#look-joystick').tap();else await page.keyboard.press('KeyE');await step(3);};
  const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
  const poses=[];
  const snap=async label=>{
   await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
   await page.screenshot({path:`${out}/${name}-${label}.png`});
   const pose=await page.evaluate(()=>{
    const g=window.__wireTheHouse,p=g.pvc,tool=p.rebarPliers,V=g.renderer.camera.position.constructor;
    tool.updateWorldMatrix(true,true);const pair=p.fastenerPairs[Math.min(p.fastenerIndex,p.fastenerPairs.length-1)];
    const tip=tool.localToWorld(new V().fromArray(tool.userData.tipPoint));
    const contact=pair?.rebar.userData.toolContact?pair.rebar.localToWorld(new V().fromArray(pair.rebar.userData.toolContact)):null;
    window.rebarSkinGap();return {phase:p.phase,progress:p.fastenerProgress,leftHandBounds:window.rebarLeftSkinBounds,lengthMm:tool.userData.lengthMm??null,tipGapM:contact?tip.distanceTo(contact):null,
     rightGrip:p.anatomicalGrips().find(x=>x.side>0).center.toArray(),reach:g.workerBody.telemetry.gripReachErrors,
     attachedHandles:tool.getObjectByName('rebar-plier-moving-jaw')?.children.filter(x=>/handle/i.test(x.name)).length??0,
     ties:p.fastenerPairs.map(pair=>({root:pair.rebar.position.toArray(),scale:pair.rebar.scale.toArray(),diameter:pair.rebar.userData.wireDiameterMm??null,progress:pair.rebar.userData.tighteningProgress??null})),
     geometry:g.renderer.webgl.info.memory.geometries,textures:g.renderer.webgl.info.memory.textures,calls:g.renderer.webgl.info.render.calls||null,triangles:g.renderer.webgl.info.render.triangles||null,
     left:g.pvc.heldRebar.visible,camera:g.renderer.camera.position.toArray()};
   });poses.push({label,...pose});return pose;
  };
  await use();await step(80);assert.equal((await state()).phase,'fastener-marking');
  const holes=await page.evaluate(()=>{const g=window.__wireTheHouse,a=g.pvc.fastenerArea(),volume=g.room.brickWall.volume;return[[-1,.85],[1,.75],[-1,.2],[1,.25]].map(([side,y])=>{const x=a.centreX+side*Math.min(.05,(side<0?a.outerLeft:a.outerRight)-.004),hit=volume.raycast({x,y:a.minY+(a.maxY-a.minY)*y,z:volume.frontZ+.1},{x:0,y:0,z:-1},1);if(!hit)throw new Error('Need real brick fixture');return[hit.point.x,hit.point.y,hit.point.z];});});
  const drill=async()=>{if(mobile)await page.locator('#look-joystick').tap();else {await page.mouse.down();await step(2);await page.mouse.up();}await step(3);};
  for(const hole of holes){await page.evaluate(point=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(...point);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);},hole);await step(2);await drill();await step(60);}
  assert.equal((await state()).fasteners.pairs,2);assert.equal((await state()).phase,'fastener-insert-ready');
  await snap('loose-wire');await drill();await step(140);assert.equal((await state()).phase,'fastener-tighten-ready');
  if(baseline)await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,pair=p.fastenerPairs[0],pos=pair.rebar.getWorldPosition(g.renderer.camera.position.clone()),c=g.renderer.camera;c.position.set(pos.x,Math.max(.34,pos.y+.09),pos.z+.4);c.lookAt(pos.x,pos.y+.055,pos.z+.025);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);});
  await step(2);
  const anchored=(await state()).fasteners.rebars.map(x=>x.position),ready=await snap('ready');
  const identities=await page.evaluate(()=>window.__wireTheHouse.pvc.fastenerPairs.map(pair=>pair.rebar.children.filter(o=>o.isMesh).map(o=>o.geometry.uuid)));
  // Real rendered scene, same camera/viewport and affected ready state.
  const performance=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,r=g.renderer,samples=[],frames=[];let last;
   for(let i=0;i<150;i++) {
    const start=globalThis.performance.now();window.rebarTick(1/60);if(i>=45)samples.push(globalThis.performance.now()-start);
    r.render();await r.waitForFrame();const now=await new Promise(resolve=>requestAnimationFrame(resolve));
    if(i>=45&&last!==undefined)frames.push(now-last);last=now;
   }
   samples.sort((a,b)=>a-b);frames.sort((a,b)=>a-b);
   return {simulationMeanMs:samples.reduce((a,b)=>a+b,0)/samples.length,simulationP95Ms:samples[Math.floor(samples.length*.95)],frameP95Ms:frames[Math.floor(frames.length*.95)],frameMaxMs:frames.at(-1),over50ms:frames.filter(x=>x>50).length,calls:r.webgl.info.render.calls||null,triangles:r.webgl.info.render.triangles||null,geometries:r.webgl.info.memory.geometries,textures:r.webgl.info.memory.textures};
  });
  await use();await step(8);await snap('closing');await step(15);const contact=await snap('twisting');await step(24);await snap('tight');await step(17);await snap('first-complete');
  await step(60);await snap('second-tight');await step(35);assert.equal((await state()).phase,'batch');assert.equal((await state()).installed,1);assert.equal((await state()).totalAll,100);
  assert.deepEqual((await state()).fasteners.rebars.map(x=>x.position),anchored,'Keep all holes anchored');
  const final=await page.evaluate(()=>window.__wireTheHouse.pvc.fastenerPairs.map(pair=>({progress:pair.rebar.userData.tighteningProgress,scale:pair.rebar.scale.toArray(),diameter:pair.rebar.userData.wireDiameterMm,ids:pair.rebar.children.filter(o=>o.isMesh).map(o=>o.geometry.uuid)})));
  const violations=[];
  if(ready.lengthMm!==250)violations.push('No verified 250 mm end-cutting tool');
  if(!ready.attachedHandles)violations.push('Moving jaw has no attached handle');
  if(contact.tipGapM===null||contact.tipGapM>.001)violations.push('Jaw is not seated at the wire being twisted');
  if(poses.some(p=>Object.values(p.reach).some(gap=>gap>.008)))violations.push('Anatomical hand cannot reach its physical grip');
  const minimumLeftSkinGapM=await page.evaluate(()=>window.rebarMinimumSkinGap);
  if(minimumLeftSkinGapM<.003)violations.push('Free glove intersects the cutting edges during twisting');
  if(!baseline&&poses.filter(p=>p.phase==='fastener-tightening').some(p=>p.leftHandBounds.minimum[1]<.003))violations.push('Free glove penetrates the floor');
  if(final.some(t=>t.diameter!==1.6||t.progress!==1||t.scale.some(s=>s!==1)))violations.push('Wire is not 1.6 mm with full geometry deformation and fixed root scale');
  if(JSON.stringify(final.map(x=>x.ids))!==JSON.stringify(identities))violations.push('Tightening replaces geometry buffers');
  report.cases.push({name,viewport,performance,poses,violations,final,minimumLeftSkinGapM});
  if(!baseline)assert.deepEqual(violations,[]);
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=!report.cases.some(c=>c.violations.length);
} finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,baseline,cases:report.cases.map(c=>({name:c.name,violations:c.violations,performance:c.performance})),errors:report.errors}));
if(!report.passed)process.exitCode=1;
