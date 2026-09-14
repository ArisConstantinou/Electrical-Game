import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const base=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/',out=process.argv[3]??'output/hose-nozzle';await mkdir(out,{recursive:true});
const report={base,mobileIsEmulation:true,cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const backend of process.env.QA_PLATFORM?[process.env.QA_PLATFORM]:['webgl','webgpu']){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:3});await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  // Keep a loaded test fixture stable while independent source work is active.
  await page.routeWebSocket('**',()=>{});
  await page.goto(base+(backend==='webgl'?'?renderer=webgl':''));await page.locator('#start-button').tap({timeout:120000});
  await page.evaluate(async()=>{
   const g=window.__wireTheHouse,v=g.room.brickWall.volume;
   for(let i=0;i<70;i++){const hit=v.raycast({x:.64+i%7*.022,y:1.40+Math.floor(i/7)*.016,z:-2},{x:0,y:0,z:-1},.8);if(hit)v.impact({point:hit.point,direction:{x:0,y:0,z:-1},edge:{x:1,y:0,z:0},chisel:'flat',widthM:.05,energyJ:8});}
   g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
   window.__hoseFrames=[];window.__hoseSample=false;const original=g.step.bind(g);
   g.step=(...args)=>{original(...args);if(window.__hoseSample&&args[2]!==false){const t=g.fpsRig.tools.get('hose');window.__hoseFrames.push({quaternion:t.quaternion.toArray(),tip:g.fpsRig.toolTipWorld(g.renderer.camera,'hose').toArray(),direction:g.fpsRig.waterGunDirectionWorld().toArray(),pitch:g.player.pitch,yaw:g.player.yaw});}};
  });
  await page.locator('[data-tool="hose"]').tap();const cdp=await context.newCDPSession(page);
  for(const distance of [.30,.65,1.2])for(const mode of ['mist','shower','jet','flood']){
   await page.evaluate(distance=>{const g=window.__wireTheHouse,c=g.renderer.camera,v=g.room.brickWall.volume;c.position.set(.7,g.player.eyeHeight,v.frontZ+distance);c.lookAt(.7,1.47,v.frontZ-.025);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;},distance);
   // Cycle the actual touch flow control, preserving its production handler.
   const target=['mist','shower','jet','flood'].indexOf(mode);
   while(await page.evaluate(()=>window.__wireTheHouse.waterGunModeIndex)!==target)await page.locator('#quick-water-flow').tap();
   await page.waitForTimeout(250);
   const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:b.x+b.width*.5,y:b.y+b.height*.65}]});
   await page.evaluate(()=>{window.__hoseFrames=[];window.__hoseSample=true;});await page.waitForTimeout(950);
   const result=await page.evaluate(()=>{window.__hoseSample=false;const g=window.__wireTheHouse,w=g.roomWater;const detachedDiameterMm=Math.max(0,...[w.droplets,w.sprayDrops].flatMap(mesh=>Array.from({length:mesh.count},(_,i)=>{const a=mesh.instanceMatrix.array,j=i*16;return 2000*Math.max(Math.hypot(a[j],a[j+1],a[j+2]),Math.hypot(a[j+8],a[j+9],a[j+10]));})));return{detachedDiameterMm,frames:window.__hoseFrames,litres:g.mortar.waterGunLitres,segments:w.telemetry.jetStreamSegments,drops:w.telemetry.sprayDrops,coreVisible:w.jetCore.visible,streamOpacity:w.jetStreams.material.opacity,coreOpacity:w.jetCore.material.opacity,emissive:w.jetStreams.material.emissive.getHex(),errors:g.renderer.renderError,locked:!!document.pointerLockElement};});
   await page.screenshot({path:`${out}/${backend}-${distance}-${mode}.png`});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   let maxAngle=0;for(let i=1;i<result.frames.length;i++){const a=result.frames[i-1].quaternion,b=result.frames[i].quaternion;maxAngle=Math.max(maxAngle,2*Math.acos(Math.min(1,Math.abs(a.reduce((s,v,j)=>s+v*b[j],0)))));}
   report.cases.push({backend,distance,mode,maxAngle,...result});
   if(!process.env.QA_BASELINE){assert(result.frames.length>10);assert(result.detachedDiameterMm<=3.601,`${backend}/${distance}/${mode}: huge detached water drops`);assert(maxAngle<.015,`${backend}/${distance}/${mode}: stationary nozzle rotates ${maxAngle} radians`);assert(result.streamOpacity<=.15&&result.coreOpacity>=.25&&result.coreOpacity<=.35&&result.emissive===0);if(mode==='mist'){assert.equal(result.segments,0);assert(!result.coreVisible);assert(result.drops>0);}}
   assert(!result.locked&&!result.errors);console.log(JSON.stringify({backend,distance,mode,maxAngle,frames:result.frames.length,segments:result.segments,drops:result.drops}));
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
