import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const out=process.argv[2]??'output/box-fit-preview-ui',base=new URL(process.env.QA_BASE??'http://127.0.0.1:5362/Electrical-Game/');
if(process.env.QA_WEBGL==='1')base.searchParams.set('renderer','webgl');
const url=base.href;await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,fixture:'Real saved MasonryVolume node removals create narrow, shallow and full-depth recesses plus a front-shell cutaway. Actual geometry and collision stay active. Native keyboard/touch controls select presets, refuse blocked insertion, place and retrieve casings; only camera and simulation clock are fixtures.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const step=(page,n=2)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__fitStep(1/60,1/60,false);},n);
const press=async(page,selector,mobile)=>{await page.locator(selector)[mobile?'tap':'click']();await step(page);};
const refresh=async page=>{await page.waitForTimeout(100);await step(page,3);};
async function tool(page,kind,mobile){if(mobile)await press(page,`[data-tool="${kind}"]`,true);else{await page.keyboard.press({fitting:'Digit5',level:'Digit6',spray:'Digit3',hammer:'Digit4'}[kind]);await step(page);}await refresh(page);}
async function aim(page,x,y=1.22,distance=.46){await page.evaluate(({x,y,distance})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);c.lookAt(x,y,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.player.workPosition.locked=false;g.player.workPosition.released=false;},{x,y,distance});await step(page,60);await refresh(page);}
async function use(page,mobile){if(mobile){const b=await page.locator('#look-joystick').boundingBox(),cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:21}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.keyboard.press('KeyE');await step(page);await refresh(page);}
const state=page=>page.evaluate(()=>{const g=window.__wireTheHouse,p=g.boxFitPreview,status=document.querySelector('#box-fit-status');return{assessment:p.assessment,guide:p.telemetry.guide,checks:p.checks,previewVisible:p.root.visible,highlightCount:p.blockedMesh.count,status:status?.dataset.fit,text:status?.textContent,size:document.querySelector('#box-fit-size')?.textContent,prompt:document.querySelector('#interaction-prompt')?.textContent,handKinds:[...g.fpsRig.fittingBoxKinds],points:g.mission.points.map(p=>({id:p.definition.id,visible:p.boxGroup.visible,kinds:p.definition.boxes,stage:p.stage,position:p.boxGroup.getWorldPosition(g.renderer.camera.position.clone()).toArray()})),profile:g.room.brickWall.volume.options.hollowProfile,overflow:document.documentElement.scrollWidth>innerWidth,error:g.renderer.renderError,locked:!!document.pointerLockElement};});
async function shot(page,name){await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});return await page.screenshot({path:`${out}/${name}.png`});}
async function fitLayout(page,mobile){
 const bounds=await page.evaluate(()=>{
  const rect=selector=>{const b=document.querySelector(selector).getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
  return{panel:rect('#box-supply'),joystick:rect('#joystick'),viewport:{width:innerWidth,height:innerHeight}};
 });
 const {panel:p,joystick:j,viewport:v}=bounds;
 assert(p.x>=0&&p.y>=0&&p.right<=v.width&&p.bottom<=v.height,'Fit guidance stays within the viewport');
 if(mobile)assert(p.right<=j.x||j.right<=p.x||p.bottom<=j.y||j.bottom<=p.y,'Fit guidance must not sit underneath the movement joystick');
 return bounds;
}
async function redTilePixels(page,png){
 return await page.evaluate(async base64=>{
  // Decode the actual screenshot, rather than trusting instanceColor or an
  // unrendered material. An empty first draw previously compiled white tiles.
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();
  const g=window.__wireTheHouse,fit=g.boxFitPreview.assessment,t=fit.target,w=fit.required.width/2,h=fit.required.height/2,points=[];
  for(const x of [-w,w])for(const y of [-h,h]){const p=g.renderer.camera.position.clone().set(t.x+x,t.y+y,t.wallFrontZ+.002).project(g.renderer.renderCamera);points.push({x:(p.x+1)*canvas.width/2,y:(1-p.y)*canvas.height/2});}
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  // Exclude the red wire perimeter, so a white fill cannot pass on its outline.
  const x0=Math.max(0,Math.ceil(minX+(maxX-minX)*.15)),x1=Math.min(canvas.width,Math.floor(maxX-(maxX-minX)*.15));
  const y0=Math.max(0,Math.ceil(minY+(maxY-minY)*.15)),y1=Math.min(canvas.height,Math.floor(maxY-(maxY-minY)*.15));
  const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,reticle=6*canvas.width/innerWidth;let red=0,samples=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   if(Math.abs(x-canvas.width/2)<reticle&&Math.abs(y-canvas.height/2)<reticle)continue;
   const i=(y*canvas.width+x)*4,r=pixels[i],green=pixels[i+1],blue=pixels[i+2];samples++;
   if(r>110&&r>2.4*green&&r>2*blue)red++;
  }
  return{samples,red,fraction:red/Math.max(1,samples),region:{x0,y0,x1,y1},method:'Rendered screenshot pixels inside footprint, excluding outline and reticle; red ratio exceeds orange brick.'};
 },png.toString('base64'));
}
const visible=s=>s.points.filter(p=>p.visible);
const sameTarget=(a,b,message)=>assert(Math.hypot(a.x-b.x,a.y-b.y,a.wallFrontZ-b.wallFrontZ)<1e-8,message);
try{
 for(const [name,viewport,mobile] of [['desktop',{width:1366,height:768},false],['mobile',{width:390,height:844},true],['landscape',{width:844,height:390},true]]){
  if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==name)continue;
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));
  await page.routeWebSocket('**',()=>{});
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.boxFitPreview&&window.__wireTheHouse?.roomWater.waterProActive,undefined,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();
  const fixture=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,v=g.room.brickWall.volume;window.__fitStep=g.step.bind(g);g.step=()=>{};await g.renderer.waitForFrame();
   const instanceColorBeforeBoxSelection=!!g.boxFitPreview.blockedMesh.instanceColor;
   const backend=JSON.parse(window.render_game_to_text()).water.backend;
   const areas=[{x:-.85,y:1.22,width:.042,height:.14,depth:.075},{x:0,y:1.22,width:.30,height:.14,depth:.012},{x:.85,y:1.22,width:.105,height:.14,depth:.075},{x:1.65,y:1.22,width:.38,height:.14,depth:.075},{x:0,y:.67,width:.90,height:.40,depth:.026},{x:2.35,y:1.2,width:.38,height:.55,depth:.075}];
   const save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
   for(const area of areas)for(let x=Math.max(1,Math.floor((area.x-area.width/2+v.width/2)/v.hx));x<=Math.ceil((area.x+area.width/2+v.width/2)/v.hx)+1;x++)for(let y=Math.floor((area.y-area.height/2)/v.hy);y<=Math.ceil((area.y+area.height/2)/v.hy)+1;y++)for(let z=1;z<=Math.ceil(area.depth/v.hz);z++){
    const p=v.nodePosition(x,y,z);if(Math.abs(p.x-area.x)>area.width/2||Math.abs(p.y-area.y)>area.height/2||!v.nodeMaterial(x,y,z))continue;
    const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,index=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
    if(!chunks.has(key))chunks.set(key,new Map());if(!chunks.get(key).has(index)){chunks.get(key).set(index,[index,255,1]);removed++;}
   }
   save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();return{areas,removed,initialPoints:g.mission.points.length,instanceColorBeforeBoxSelection,backend};
  });
  assert(fixture.removed>0);assert(fixture.instanceColorBeforeBoxSelection,'Instance colours exist before any empty preview compiles');
  assert.equal(fixture.backend,process.env.QA_WEBGL==='1'?'webgl':'webgpu');
  // Begin outside the stance and approach with actual movement input. Selecting
  // BOX while the hammer remains locked must take up hand reach automatically.
  await tool(page,'hammer',mobile);await aim(page,2.35,1.22,1.3);
  if(mobile){const b=await page.locator('#joystick').boundingBox(),cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:51}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+4,id:51}]});await step(page,120);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{await page.keyboard.down('KeyW');await step(page,120);await page.keyboard.up('KeyW');}
  await step(page,30);
  const hammerStance=await page.evaluate(()=>{const g=window.__wireTheHouse;return{...g.player.workPosition};});assert(hammerStance.locked&&hammerStance.distanceM>.7,'Native approach enters the longer hammer stance');
  await tool(page,'fitting',mobile);await press(page,'#box-preset-2G-1G',mobile);await step(page,120);await refresh(page);
  const transition=await state(page),handStance=await page.evaluate(()=>({...window.__wireTheHouse.player.workPosition}));
  assert(Math.abs(handStance.distanceM-.46)<.002,'BOX selection takes up hand reach without another forward gesture');assert.equal(transition.status,'fits');assert.deepEqual(transition.handKinds,['2G','1G']);
  await shot(page,`${name}-hammer-to-box-reachable`);await use(page,mobile);assert.equal(visible(await state(page)).length,1,'Native USE places the mixed group after hammer approach');await use(page,mobile);assert.equal(visible(await state(page)).length,0,'Native USE retrieves the placed mixed group');
  await aim(page,-1.65,1.22,2);await tool(page,'fitting',mobile);await press(page,'#box-preset-1G',mobile);await refresh(page);const far=await state(page);assert.equal(far.status,'out-of-reach');assert(far.highlightCount>0,'Distant inspection still shows masonry/depth obstructions');assert.match(far.text,/REMOVE MARKED.*MOVE CLOSER/);await shot(page,`${name}-distant-blocked-preview`);await use(page,mobile);assert.equal(visible(await state(page)).length,0);
  await aim(page,-1.65);await step(page,60);const intact=await state(page);assert.equal(intact.assessment.fits,false);assert.equal(intact.status,'blocked');assert(intact.highlightCount>0&&intact.previewVisible);assert(intact.assessment.proudDepthM>.025);assert.match(intact.text,/mm/i);await step(page,120);const idle=await state(page);assert.equal(idle.checks,intact.checks,'Stationary BOX reuses the completed fit assessment');const tilePixels=await redTilePixels(page,await shot(page,`${name}-intact-blocked`));assert(tilePixels.samples>100&&tilePixels.fraction>.05,`${name}: cold far-to-near preview must render red filled tiles, not white (${JSON.stringify(tilePixels)})`);await use(page,mobile);assert.equal(visible(await state(page)).length,0,'Intact masonry refuses placement');
  await tool(page,'hammer',mobile);const pinned=await state(page);assert(pinned.guide&&pinned.previewVisible,'Failed placement remains a hammer excavation guide');sameTarget(pinned.assessment.target,intact.assessment.target);await shot(page,`${name}-hammer-pinned-guide`);await aim(page,-.85);const lookedAway=await state(page);assert(lookedAway.guide&&lookedAway.previewVisible);sameTarget(lookedAway.assessment.target,pinned.assessment.target,'Hammer look cannot move the intended box recess');await tool(page,'spray',mobile);assert.equal((await state(page)).previewVisible,false,'Other tools hide the guide');await tool(page,'fitting',mobile);
  await aim(page,-.85);const narrow=await state(page);assert.equal(narrow.assessment.fits,false);assert(narrow.assessment.blockedCells.some(c=>Math.abs(c.x-narrow.assessment.target.x)>.02),'Narrow cavity identifies remaining side masonry');await shot(page,`${name}-narrow-side-highlight`);await use(page,mobile);assert.equal(visible(await state(page)).length,0);
  await aim(page,0);const shallow=await state(page);assert.equal(shallow.assessment.fits,false);assert(shallow.assessment.proudDepthM>.008&&shallow.assessment.proudDepthM<intact.assessment.proudDepthM,'Shallow recess reports remaining depth');await shot(page,`${name}-shallow-depth`);await use(page,mobile);assert.equal(visible(await state(page)).length,0);
  await aim(page,.85);const smallFits=await state(page);assert.equal(smallFits.assessment.fits,true);assert.equal(smallFits.status,'fits');assert.deepEqual(smallFits.handKinds,['1G']);assert.doesNotMatch(smallFits.prompt,/does not fit/i,'A previous failed position must not contradict a current green fit');assert.equal(smallFits.highlightCount,0);assert(smallFits.previewVisible);
  await press(page,'#box-preset-2G',mobile);await refresh(page);const largerBlocked=await state(page);assert.equal(largerBlocked.assessment.fits,false);assert.deepEqual(largerBlocked.handKinds,['2G']);assert(largerBlocked.assessment.required.width>smallFits.assessment.required.width);assert(largerBlocked.highlightCount>0);await shot(page,`${name}-preset-width-blocked`);
  await press(page,'#box-preset-1G',mobile);await refresh(page);assert.equal((await state(page)).points.length,fixture.initialPoints,'Aiming and preset preview never allocate mission points');await shot(page,`${name}-clear-green-fit`);await use(page,mobile);await step(page,150);await refresh(page);const firstPlaced=await state(page),first=visible(firstPlaced)[0];assert(first);assert.equal(first.kinds.join('+'),'1G');assert.equal(firstPlaced.status,'retrieve');assert.equal(firstPlaced.previewVisible,false,'Existing casing target hides fit overlay');
  await press(page,'#box-preset-2G-1G',mobile);await aim(page,1.65);const wide=await state(page);assert.equal(wide.assessment.fits,true);assert.deepEqual(wide.handKinds,['2G','1G']);assert(wide.assessment.required.width>largerBlocked.assessment.required.width);await use(page,mobile);await step(page,150);await refresh(page);const two=await state(page);assert.equal(visible(two).length,2);assert.deepEqual(two.points.find(p=>p.id===first.id).position,first.position,'Independent second group preserves first');
  await aim(page,first.position[0],first.position[1]);const retrievalPreview=await state(page);assert.equal(retrievalPreview.status,'retrieve');assert.equal(retrievalPreview.previewVisible,false);await use(page,mobile);const retrieved=await state(page);assert.equal(visible(retrieved).length,1);assert.deepEqual(retrieved.handKinds,['1G'],'Retrieved casing becomes the held preset');assert.equal(retrieved.points.find(p=>p.id===first.id).visible,false);assert(visible(retrieved).some(p=>p.kinds.join('+')==='2G+1G'));
  await tool(page,'spray',mobile);await aim(page,0,.67,.75);await shot(page,`${name}-horizontal-brick-cutaway`);const final=await state(page);assert.equal(final.profile,'horizontal-rounded');assert.equal(final.previewVisible,false);assert.equal(final.overflow,false);assert.equal(final.error,'');assert.equal(final.locked,false);
  await tool(page,'fitting',mobile);await aim(page,-1.65);const layout=await fitLayout(page,mobile);
  report.cases.push({name,viewport,fixture,hammerStance,handStance,transition,far,tilePixels,layout,intact,pinned,lookedAway,narrow,shallow,smallFits,largerBlocked,wide,firstPlaced,two,retrieved,final});console.log(JSON.stringify({platform:name,passed:true,redTileFraction:tilePixels.fraction}));await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,platforms:report.cases.map(c=>c.name)}));
