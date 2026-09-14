import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const out=process.argv[2]??'output/multiple-boxes-ui';await mkdir(out,{recursive:true});
const url=process.env.QA_BASE??'http://127.0.0.1:5362/Electrical-Game/';
const report={url,fixture:'Actual saved MasonryVolume node removals create five independent 75 mm recesses with surviving brick ledges. Only camera and frame clock are controlled. Presets, placement, selection, rotation, cancellation and retrieval use native keyboard/touch. No box geometry, placement state, clearance or acceptance method is stubbed.',mobileIsEmulation:true,cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const steps=(page,count=1)=>page.evaluate(count=>{for(let i=0;i<count;i++)window.__multipleStep(1/60,1/60,false);},count);
const click=async(page,selector,mobile)=>{await page.locator(selector)[mobile?'tap':'click']();await steps(page,2);};
async function select(page,tool,mobile){if(mobile)await click(page,`[data-tool="${tool}"]`,true);else{await page.keyboard.press(tool==='fitting'?'Digit5':'Digit6');await steps(page);}}
async function use(page,mobile){
 if(mobile){const b=await page.locator('#look-joystick').boundingBox(),cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:11}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else await page.keyboard.press('KeyE');
 await steps(page,2);
}
async function aim(page,x,y=1.22,distance=.46){
 await page.evaluate(({x,y,distance})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);c.lookAt(x,y,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.player.workPosition.locked=false;g.player.workPosition.released=false;},{x,y,distance});
 await steps(page,60);
}
const state=page=>page.evaluate(()=>{
 const g=window.__wireTheHouse;
 return{active:g.mission.activePoint?.definition.id,preset:g.mission.boxPreset,rig:g.fpsRig.visible,overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError,locked:!!document.pointerLockElement,points:g.mission.points.map(p=>{p.updateWorldMatrix(true,true);return{id:p.definition.id,kinds:p.definition.boxes,visible:p.boxGroup.visible,position:p.boxGroup.getWorldPosition(g.renderer.camera.position.clone()).toArray(),tilt:p.boxGroup.tiltDegrees,stage:p.stage,level:p.boxGroup.levelBar.visible,placement:p.boxGroup.userData.placement?{...p.boxGroup.userData.placement}:null};})};
});
async function shot(page,name){await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});}
const layout=page=>page.evaluate(()=>{
 const rect=selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r&&r.width&&r.height?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null;};
 const g=window.__wireTheHouse,p=g.mission.activePoint,pixel=p.boxGroup.getWorldPosition(g.renderer.camera.position.clone()).project(g.renderer.renderCamera);
 const boxBounds={x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity};
 for(const box of p.boxGroup.boxes)box.traverse(child=>{if(!child.isMesh)return;child.geometry.computeBoundingBox();const b=child.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const q=g.renderer.camera.position.clone().set(x,y,z).applyMatrix4(child.matrixWorld).project(g.renderer.renderCamera),sx=(q.x+1)*innerWidth/2,sy=(1-q.y)*innerHeight/2;boxBounds.x=Math.min(boxBounds.x,sx);boxBounds.y=Math.min(boxBounds.y,sy);boxBounds.right=Math.max(boxBounds.right,sx);boxBounds.bottom=Math.max(boxBounds.bottom,sy);}});
 return{objective:rect('#top-hud'),supply:rect('#box-supply'),panel:rect('#level-panel'),boxBounds,boxCenter:{x:(pixel.x+1)*innerWidth/2,y:(1-pixel.y)*innerHeight/2},buttons:[...document.querySelectorAll('[data-level]')].map(e=>{const r=e.getBoundingClientRect();return{name:e.dataset.level,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,topmost:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-level]')===e};})};
});
const unchanged=(before,after,except=[])=>{for(const p of before.points.filter(p=>p.visible&&!except.includes(p.id))){const q=after.points.find(q=>q.id===p.id);assert(q?.visible,`${p.id} stays placed`);assert.deepEqual(q.position,p.position,`${p.id} does not move while working elsewhere`);assert.equal(q.tilt,p.tilt);}};
try{
 for(const [name,viewport,mobile] of [['desktop',{width:1366,height:768},false],['mobile',{width:390,height:844},true],['landscape',{width:844,height:390},true]]){
  if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==name)continue;
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,undefined,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();
  const fixture=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,v=g.room.brickWall.volume;window.__multipleStep=g.step.bind(g);g.step=()=>{};await g.renderer.waitForFrame();
   const save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
   for(let x=1;x<=v.nx;x++)for(let y=Math.floor(1.15/v.hy);y<=Math.ceil(1.29/v.hy);y++)for(let z=1;z<=Math.ceil(.075/v.hz);z++){
    const p=v.nodePosition(x,y,z);if(![-1.65,-.85,0,.85,1.65].some(cx=>Math.abs(p.x-cx)<.19)||p.y<1.155||p.y>1.285||!v.nodeMaterial(x,y,z))continue;
    const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,index=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
    if(!chunks.has(key))chunks.set(key,new Map());chunks.get(key).set(index,[index,255,1]);removed++;
   }
   save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
   return{removed,removedVolume:v.removedVolume,centres:[-.85,0,.85,1.65].map(x=>v.cavityBox({x:x-.115,y:1.185,z:v.frontZ-.043},{x:x+.115,y:1.255,z:v.frontZ+.001}).clear)};
  });
  assert(fixture.removed>0);assert(fixture.centres.every(Boolean));await select(page,'fitting',mobile);
  const placed=[];let previous=await state(page);
  for(const [preset,x] of [['1G',-.85],['2G',0],['2G-1G',.85],['1G',1.65]]){
   await click(page,`#box-preset-${preset}`,mobile);await aim(page,x);await use(page,mobile);await steps(page,150);
   const s=await state(page),p=s.points.find(p=>p.id===s.active);assert(p?.visible,`${name}: native ${preset} placed`);assert.equal(p.kinds.join('-'),preset);assert.equal(p.placement?.state,'supported',`${name}: actual brick ledge supports ${preset}`);assert.equal(p.placement.secured,false);unchanged(previous,s);placed.push(p.id);previous=s;
  }
  assert.equal(new Set(placed).size,4);assert(placed.some(id=>id.startsWith('extra-')),'Repeated size creates a dynamic point');assert.equal(previous.points.filter(p=>p.visible).length,4);
  const first=previous.points.find(p=>p.id===placed[0]);await select(page,'level',mobile);await aim(page,first.position[0],first.position[1]);await use(page,mobile);
  const level=await state(page);assert.equal(level.active,first.id);assert.equal(level.points.find(p=>p.id===first.id).stage,'leveling');assert.equal(level.rig,false,'Placed level has no duplicate handheld rig');assert.equal(level.points.filter(p=>p.level).length,1);
  await shot(page,`${name}-level-seated`);
  const levelLayout=await layout(page);assert(levelLayout.panel);assert(!((levelLayout.boxCenter.x>=levelLayout.panel.x&&levelLayout.boxCenter.x<=levelLayout.panel.right)&&(levelLayout.boxCenter.y>=levelLayout.panel.y&&levelLayout.boxCenter.y<=levelLayout.panel.bottom)),'Physical selected box must remain outside leveling panel');
  assert(!(levelLayout.boxBounds.x<levelLayout.panel.right&&levelLayout.boxBounds.right>levelLayout.panel.x&&levelLayout.boxBounds.y<levelLayout.panel.bottom&&levelLayout.boxBounds.bottom>levelLayout.panel.y),'The complete physical casing must remain clear of leveling controls');
  for(const b of levelLayout.buttons){assert(b.topmost,`${name}: native ${b.name} receives pointer`);assert(b.x>=0&&b.y>=0&&b.right<=viewport.width&&b.bottom<=viewport.height);if(mobile)assert(b.height>=44,`${name}: touch target height`);}
  await click(page,'[data-level="right"]',mobile);await click(page,'[data-level="right"]',mobile);const rotated=await state(page);assert(rotated.points.find(p=>p.id===first.id).tilt>first.tilt,'Native rotation changes selected earlier box');unchanged(previous,rotated,[first.id]);await shot(page,`${name}-level-rotated`);
  await click(page,'[data-level="left"]',mobile);await click(page,'[data-level="left"]',mobile);const aligned=await state(page);assert(Math.abs(aligned.points.find(p=>p.id===first.id).tilt)<1e-8);
  await click(page,'[data-level="confirm"]',mobile);const dryConfirm=await state(page);assert.notEqual(dryConfirm.points.find(p=>p.id===first.id).stage,'leveled','Dry support alone cannot complete mortar work');
  if(dryConfirm.points.find(p=>p.id===first.id).stage!=='leveling')await use(page,mobile);
  await click(page,'[data-level="cancel"]',mobile);await steps(page,120);const exited=await state(page);assert.equal(exited.points.filter(p=>p.level).length,0);assert(exited.rig);
  await select(page,'fitting',mobile);await click(page,'#box-preset-2G',mobile);
  const middle=exited.points.find(p=>p.id===placed[1]);await aim(page,middle.position[0],middle.position[1]);await use(page,mobile);const retrieved=await state(page);assert.equal(retrieved.points.find(p=>p.id===middle.id).visible,false);unchanged(exited,retrieved,[middle.id]);
  await aim(page,-1.65);await use(page,mobile);await steps(page,150);const moved=await state(page);assert.equal(moved.active,middle.id);assert(moved.points.find(p=>p.id===middle.id).position[0]<-1.5);unchanged(retrieved,moved,[middle.id]);
  const overlapFirst=moved.points.find(p=>p.id===first.id);await aim(page,overlapFirst.position[0]+.06,overlapFirst.position[1]);await use(page,mobile);const overlap=await state(page);assert.equal(overlap.points.filter(p=>p.visible).length,4,'Overlapping fifth placement rejected');unchanged(moved,overlap);assert.match(await page.locator('#box-fit-status').textContent(),/another box|blocks/i);
  await click(page,'#box-preset-1G',mobile);await aim(page,overlapFirst.position[0]-.12,overlapFirst.position[1]);await use(page,mobile);await steps(page,150);const adjacent=await state(page),added=adjacent.points.find(p=>p.id===adjacent.active);
  assert.equal(adjacent.points.filter(p=>p.visible).length,5,'Another independent box fits beside the first in the same chase');assert.equal(added.kinds.join('+'),'1G');assert.equal(added.placement.state,'supported');assert(Math.abs(added.position[0]-first.position[0]+.12)<.002);unchanged(overlap,adjacent);
  await shot(page,`${name}-two-boxes-one-chase`);
  await select(page,'level',mobile);await aim(page,first.position[0],adjacent.points.find(p=>p.id===first.id).position[1]);await use(page,mobile);await shot(page,`${name}-shared-chase-level`);await click(page,'[data-level="cancel"]',mobile);await select(page,'fitting',mobile);
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,1.65,1);c.lookAt(0,1.2,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await shot(page,`${name}-five-independent-boxes`);
  const final=await state(page),finalLayout=await layout(page);assert.equal(final.overflow,false);assert.equal(final.renderError,'');assert.equal(final.locked,false);if(finalLayout.supply&&finalLayout.objective)assert(finalLayout.supply.y>=finalLayout.objective.bottom,`${name}: supply does not overlap objective`);report.cases.push({name,viewport,fixture,placed,level,levelLayout,rotated,adjacent,final,finalLayout});console.log(JSON.stringify({platform:name,passed:true,visible:final.points.filter(p=>p.visible).length}));await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,platforms:report.cases.map(c=>c.name),cases:report.cases.length}));
