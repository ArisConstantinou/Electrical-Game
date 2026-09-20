import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/',out=process.argv[3]??'output/box-mortar-fit-ui';await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,fixture:'Actual masonry node cuts and finite fresh production mortar deposits over narrow, shallow and full recesses. Native preset selection and USE attempt insertion; no fit, collision or acceptance functions are replaced.',cases:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mobile of [false,true]){
 const platform=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,null,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();
 const steps=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__wetFitStep(1/60,1/60,false);},n);
 const use=async()=>{if(mobile){const b=await page.locator('#look-joystick').boundingBox(),cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:7}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.keyboard.press('KeyE');await steps(8);};
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar.telemetry;return{fit:g.boxFitPreview.assessment,mode:g.boxFitPreview.mode,tiles:g.boxFitPreview.blockedMesh.count,mass:g.mortar.field.mass,totalMass:g.mortar.field.mass+m.movingKg+m.floorKg+m.restingKg,wall:g.room.brickWall.volume.removedNodeCount,visible:g.mission.points.filter(p=>p.boxGroup.visible).map(p=>({id:p.definition.id,depth:p.boxGroup.position.z,flush:p.boxGroup.isFlush,minimum:p.boxGroup.userData.minimumDepth})),text:document.querySelector('#box-fit-status').textContent,overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError};});
 const fixture=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,v=g.room.brickWall.volume;window.__wetFitStep=g.step.bind(g);g.step=()=>{};
  const areas=[{x:-.7,width:.042,depth:.075},{x:0,width:.30,depth:.012},{x:.7,width:.30,depth:.075}];
  const save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
  for(const a of areas)for(let x=Math.max(1,Math.floor((a.x-a.width/2+v.width/2)/v.hx));x<=Math.ceil((a.x+a.width/2+v.width/2)/v.hx)+1;x++)for(let y=Math.floor(1.15/v.hy);y<=Math.ceil(1.29/v.hy)+1;y++)for(let z=1;z<=Math.ceil(a.depth/v.hz);z++){
   const p=v.nodePosition(x,y,z);if(Math.abs(p.x-a.x)>a.width/2||Math.abs(p.y-1.22)>.07||!v.nodeMaterial(x,y,z))continue;
   const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,index=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
   if(!chunks.has(key))chunks.set(key,new Map());if(!chunks.get(key).has(index)){chunks.get(key).set(index,[index,255,1]);removed++;}
  }
  save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
  const V=g.renderer.camera.position.constructor;let added=0;
  for(const a of [...areas,{x:-1.4}])for(let pass=0;pass<6;pass++)for(const dx of [-.07,0,.07]){const held=g.mortar.deposit(new V(a.x+dx,1.22,v.frontZ-.006),.65,new V(0,0,1),false,.65);g.mortar.launchedMass+=.65;g.mortar.stuckMass+=held;g.mortar.floorMass+=.65-held;added+=held;g.mortar.field.tick(.25);}
  await g.mortar.waitForGeometry();return{removed,addedKg:added};
 });assert(fixture.addedKg>0);
 if(mobile)await page.locator('[data-tool="fitting"]').tap();else await page.keyboard.press('Digit5');await steps(3);
 await page.locator('#box-preset-2G')[mobile?'tap':'click']();await steps(2);await page.locator('#box-next-kind')[mobile?'tap':'click']();await steps(2);await page.locator('[data-box-zone="2"]')[mobile?'tap':'click']();await steps(24);
 const cases=[];
 for(const [kind,x] of [['untouched',-1.4],['narrow',-.7],['shallow',0],['full',.7]]){
  await page.evaluate(x=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.46);c.lookAt(x,1.22,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},x);await steps(150);
  const before=await state();await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});const png=await page.screenshot({path:`${out}/${platform}-${kind}.png`});
  await page.evaluate(async()=>{const g=window.__wireTheHouse;g.boxFitPreview.blockedMesh.visible=false;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});const hidden=await page.screenshot();await page.evaluate(()=>{window.__wireTheHouse.boxFitPreview.blockedMesh.visible=true;});
  const marked=await page.evaluate(async ({b64,hidden})=>{
   const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
   const hiddenBitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(hidden),c=>c.charCodeAt(0))],{type:'image/png'})),hiddenCanvas=new OffscreenCanvas(canvas.width,canvas.height),hiddenContext=hiddenCanvas.getContext('2d',{willReadFrequently:true});hiddenContext.drawImage(hiddenBitmap,0,0);hiddenBitmap.close();const before=hiddenContext.getImageData(0,0,canvas.width,canvas.height).data;
   const g=window.__wireTheHouse,f=g.boxFitPreview.assessment,t=f.target,points=[];
   for(const x of [-f.required.width*.4,f.required.width*.4])for(const y of [-f.required.height*.35,f.required.height*.35]){const p=g.renderer.camera.position.clone().set(t.x+x,t.y+y,t.wallFrontZ+.01).project(g.renderer.renderCamera);points.push([(p.x+1)*canvas.width/2,(1-p.y)*canvas.height/2]);}
   const x0=Math.max(0,Math.ceil(Math.min(...points.map(p=>p[0])))),x1=Math.min(canvas.width,Math.floor(Math.max(...points.map(p=>p[0])))),y0=Math.max(0,Math.ceil(Math.min(...points.map(p=>p[1])))),y1=Math.min(canvas.height,Math.floor(Math.max(...points.map(p=>p[1]))));const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0;
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*canvas.width+x)*4;if(Math.abs(data[i]-before[i])+Math.abs(data[i+1]-before[i+1])+Math.abs(data[i+2]-before[i+2])>30)count++;}return count;
  },{b64:png.toString('base64'),hidden:hidden.toString('base64')});
  await use();const after=await state();
  assert(Math.abs(after.totalMass-before.totalMass)<1e-7,'A placement attempt conserves finite mortar mass');assert.equal(after.wall,before.wall,'A placement attempt cannot destroy masonry');
  if(kind==='full'){
   assert(before.fit.canPlace&&before.fit.fits,'A complete recess with yielding fresh mortar remains usable');assert.equal(after.visible.length,1,'Native USE seats a clear box assembly');
   const placed=after.visible[0];assert(Math.abs(placed.depth-before.fit.seatDepthM)<1e-7,'The placed front rim matches the detected mortar finish plane');assert(placed.flush);
  }else{
   assert(!before.fit.canPlace&&!before.fit.fits&&before.tiles>0);assert.equal(before.mode,'blocked');assert.match(before.text,/REMOVE MARKED/);assert.equal(after.visible.length,0,'A blocked recess cannot leave the box proud of the finish');assert(marked>20,`${platform} ${kind}: obstruction markings hidden under mortar (${marked} pixels)`);
  }
  assert(!after.overflow&&!after.renderError);cases.push({kind,marked,before,after});
  await page.evaluate(async()=>{const g=window.__wireTheHouse,c=g.renderer.camera,p=g.mission.points.find(p=>p.boxGroup.visible);if(p){const v=p.boxGroup.getWorldPosition(c.position.clone());c.position.set(v.x+.32,v.y+.18,g.room.brickWall.volume.frontZ+.55);c.lookAt(v);c.updateMatrixWorld(true);}await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${platform}-${kind}-${kind==='full'?'placed':'blocked'}.png`});
  await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points.find(p=>p.boxGroup.visible);if(p)g.boxPlacement.retrieve(p);});await steps(2);
 }
 report.cases.push({platform,fixture,cases});await context.close();console.log(JSON.stringify({platform,passed:true}));
}assert.deepEqual(report.errors,[]);}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
