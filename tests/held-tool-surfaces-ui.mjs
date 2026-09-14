import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/',out=process.argv[3]??'output/held-tool-surfaces-ui';
await mkdir(out,{recursive:true});const report={url,mobileIsEmulation:true,cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mobile of [false,true]){
 const platform=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,null,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();
 const steps=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__surfaceStep(1/60,1/60,false);},n);
 const select=async tool=>{if(mobile)await page.locator(`[data-tool="${tool}"]`).tap();else await page.keyboard.press({spray:'Digit3',fitting:'Digit5',level:'Digit6',spring:'Digit1',cutter:'Digit2',trowel:'Digit7'}[tool]);await steps(2);};
 await page.evaluate(async()=>{
  const g=window.__wireTheHouse,v=g.room.brickWall.volume;window.__surfaceStep=g.step.bind(g);g.step=()=>{};await g.renderer.waitForFrame();
  const save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
  for(let x=1;x<=v.nx;x++)for(let y=Math.floor(1.15/v.hy);y<=Math.ceil(1.29/v.hy);y++)for(let z=1;z<=Math.ceil(.075/v.hz);z++){
   const p=v.nodePosition(x,y,z);if(Math.abs(p.x)>.19||p.y<1.155||p.y>1.285||!v.nodeMaterial(x,y,z))continue;
   const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,index=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
   if(!chunks.has(key))chunks.set(key,new Map());chunks.get(key).set(index,[index,255,1]);removed++;
  }
  save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
  const c=g.renderer.camera;c.position.set(0,g.player.eyeHeight,v.frontZ+.46);c.lookAt(0,1.22,v.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
 });
 await select('fitting');await page.locator('#box-preset-2G-1G')[mobile?'tap':'click']();await steps(60);
 if(mobile){const b=await page.locator('#look-joystick').boundingBox(),cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:7}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.keyboard.press('KeyE');await steps(150);
 const setup=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,p=g.mission.activePoint,V=g.renderer.camera.position.constructor;let held=0;
  // Finite production deposits around the natively placed casing, with normal box exclusions.
  for(const x of [-.13,.13])for(let i=0;i<3;i++)held+=g.mortar.deposit(new V(x,1.22,g.room.brickWall.volume.frontZ-.025),.55,new V(0,0,1),false,.65);
  for(let i=0;i<60;i++)window.__surfaceStep(1/60,1/60,false);await g.mortar.waitForGeometry();
  return{placed:p.boxGroup.visible,heldKg:held,deposits:g.mortar.deposits.length};
 });assert(setup.placed,'Native gang box placement');assert(setup.heldKg>0&&setup.deposits>0,'Actual mortar mesh beside box');
 const cases=[];
 for(const tool of ['level','fitting','spring','cutter','spray','trowel']){
  await select(tool);
  // Aim at the casing and then just above it, reproducing the photographed idle level.
  for(const y of [1.22,1.34]){
   await page.evaluate(y=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.46);c.lookAt(0,y,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},y);await steps(150);
   const s=await page.evaluate(()=>{
    const g=window.__wireTheHouse,r=g.fpsRig,b=r.heldToolBoundsWorld(),front=g.workSurfaces.frontForBounds(b),before=g.renderer.camera.position.toArray(),q=g.renderer.camera.quaternion.toArray();
    const actual=b.clone().makeEmpty();r.tools.get(g.selectedTool).traverseVisible(o=>{if(o.isMesh){o.geometry.computeBoundingBox();actual.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}});
    const p=r.tools.get(g.selectedTool).getWorldPosition(g.renderer.camera.position.clone());for(let i=0;i<12;i++)window.__surfaceStep(1/60,1/60,false);
    return{tool:g.selectedTool,front,minZ:actual.min.z,envelopeMin:b.min.z,eyeBefore:before,eyeAfter:g.renderer.camera.position.toArray(),qBefore:q,qAfter:g.renderer.camera.quaternion.toArray(),steadyShift:p.distanceTo(r.tools.get(g.selectedTool).getWorldPosition(p.clone())),rig:r.visible,overflow:document.documentElement.scrollWidth>innerWidth,error:g.renderer.renderError,locked:!!document.pointerLockElement};
   });
   assert.equal(s.tool,tool,'Native tool selection');assert(s.rig);assert(s.front!==null&&s.minZ>=s.front+.0019,`${platform} ${tool}: no geometry behind mortar or casing`);assert(s.steadyShift<1e-7,JSON.stringify({platform,y,...s}));assert.deepEqual(s.eyeBefore,s.eyeAfter);assert.deepEqual(s.qBefore,s.qAfter);assert(!s.overflow&&!s.locked&&!s.error);cases.push({y,...s});
  }
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${platform}-${tool}.png`});
 }
 report.cases.push({platform,setup,cases});await context.close();console.log(JSON.stringify({platform,passed:true,cases:cases.length}));
}assert.deepEqual(report.errors,[]);}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
