import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='output/room-water';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report=[];
try{
for(const backend of process.argv.includes('--gpu-only')?['webgpu']:['webgpu','webgl']){
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
 await blockPointerLock(page.context());
 if(process.env.QA_FREEZE_HMR==='1')await page.addInitScript(()=>{const Original=window.WebSocket;window.WebSocket=class extends Original{addEventListener(type,callback,options){if(type!=='message')return super.addEventListener(type,callback,options);return super.addEventListener(type,event=>{try{if(['update','full-reload'].includes(JSON.parse(event.data).type))return;}catch{}if(typeof callback==='function')callback.call(this,event);else callback?.handleEvent(event);},options);}};});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:5362/Electrical-Game/${backend==='webgl'?'?renderer=webgl':''}`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__wireTheHouse,{timeout:120000});
 await page.locator('#start-button').click();await page.waitForTimeout(200);
 if(backend==='webgpu'){
  // Diagnostic cavity uses the production impact API; hose input below is
  // native. This fixture is independent of the hammer's evolving body stance.
  await page.evaluate(async()=>{
    const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume,c=g.renderer.camera.clone(false),contact=w.contactProvider;
    w.contactProvider=null;w.chiselTiltDegrees=0;
    try{for(let pass=0;pass<25;pass++)for(let x=-.47;x<=-.23;x+=.028)for(let y=.96;y<=1.24;y+=.028){
      c.position.set(x,y,v.frontZ+.6);c.lookAt(x,y,v.frontZ);c.updateMatrixWorld(true);
      const hit=v.raycast(c.position,c.getWorldDirection(c.position.clone().set(0,0,0)),1);
      if(hit&&v.frontZ-hit.point.z<.05)w.removeAtAim(c);
    }}finally{w.contactProvider=contact;}
    while(v.pendingSupportCount)w.processPendingSupport();await w.waitForGeometry();
  });
  await page.keyboard.press('Digit8');
  await page.evaluate(async()=>{if(document.pointerLockElement)await document.exitPointerLock();});await page.locator('#settings-toggle').click();await page.locator('#mortar-settings summary').click();await page.locator('#work-height').click();await page.locator('#settings-close').click();
  const nozzleContact=await page.evaluate(()=>{
    const g=window.__wireTheHouse,c=g.renderer.camera,front=g.room.brickWall.volume.frontZ;let best=null;
    // Choose a camera fixture with an unobstructed physical nozzle ray into
    // already excavated material. No geometry or water state is edited here.
    for(const cameraX of [-.8,-.65,-.55,-.45,-.3])for(const x of [-.44,-.41,-.38,-.35,-.32,-.29,-.26])for(const y of [1.00,1.03,1.06,1.09,1.12,1.15,1.18]){
      c.position.set(cameraX,g.player.eyeHeight,-1.55);c.lookAt(x,y,-2.53);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.step(0);
      const origin=g.fpsRig.toolTipWorld(c,'hose'),aim=g.mortar.contact(c.position,c.getWorldDirection(origin.clone()),3);
      if(!aim)continue;const direction=aim.point.clone().sub(origin),hit=g.mortar.contact(origin,direction.clone().normalize(),direction.length()+.01);
      if(hit&&(!best||hit.point.z<best.z))best={cameraX,x,y,z:hit.point.z,depthMm:(front-hit.point.z)*1000};
    }
    if(!best)throw Error('No physical nozzle contact fixture');
    c.position.set(best.cameraX,g.player.eyeHeight,-1.55);c.lookAt(best.x,best.y,-2.53);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.step(0);
    window.__waterInteriorRunoffDepth=0;const runoff=g.mortar.onRunoff;
    g.mortar.onRunoff=event=>{window.__waterInteriorRunoffDepth=Math.max(window.__waterInteriorRunoffDepth,(front-event.point.z)*1000);runoff?.(event);};
    return best;
  });
  assert.ok(nozzleContact.depthMm>5,'Physical nozzle ray must reach a surviving inner cavity surface');
  await page.keyboard.down('KeyE');
  await page.waitForFunction(()=>window.__wireTheHouse.roomWater.telemetry.runoffLitres>.04,undefined,{timeout:30000});
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
  await page.screenshot({path:`${output}/${backend}-chase-flow-held.png`});
  const flowing=await page.evaluate(()=>({held:window.__wireTheHouse.input.actionHeld,interiorRunoffDepthMm:window.__waterInteriorRunoffDepth,water:window.__wireTheHouse.roomWater.telemetry,masonry:window.__wireTheHouse.room.brickWall.telemetry}));
  assert.equal(flowing.held,true);assert.ok(flowing.water.runoffLitres>.04);assert.ok(flowing.water.activeDrops>0);
  assert.ok(flowing.interiorRunoffDepthMm>5,'Actual wet callback reaches the inside cavity surface');
  report.push({scenario:'native held hose into production impact API cavity fixture',nozzleContact,flowing});
  await page.keyboard.up('KeyE');
  await page.locator('#settings-toggle').click();await page.locator('#work-height').click();await page.locator('#settings-close').click();
 }
 await page.keyboard.press('Digit8');
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,1.65,.4);c.lookAt(-.4,0,-.2);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
 const beforeFloorSpray=await page.evaluate(()=>window.__wireTheHouse.roomWater.telemetry.emissionLitres);
 await page.keyboard.down('KeyE');await page.waitForFunction(before=>window.__wireTheHouse.roomWater.telemetry.emissionLitres>before+.10,beforeFloorSpray,{timeout:30000});await page.keyboard.up('KeyE');await page.waitForFunction(()=>window.__wireTheHouse.roomWater.telemetry.floorLitres>.05,undefined,{timeout:15000});
 const hose=await page.evaluate(()=>window.__wireTheHouse.roomWater.telemetry);
 assert.ok(hose.receivedLitres>.02,'normal held hose delivers litres to the floor callback');assert.ok(hose.floorLitres>.01,'actual emitted water reaches the floor');
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:`${output}/${backend}-hose.png`});
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,1.65,1.8);c.lookAt(-.7,0,-.7);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.fpsRig.visible=false;g.roomWater.addFloorWater(-.7,-.7,22);});
 await page.waitForTimeout(1600);
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:`${output}/${backend}-puddle.png`});
 const state=await page.evaluate(()=>({water:window.__wireTheHouse.roomWater.telemetry,error:window.__wireTheHouse.renderer.renderError,calls:window.__wireTheHouse.renderer.webgl.info.render.calls}));
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.roomWater.addFloorWater(.7,-.7,22);for(let i=0;i<180;i++)g.roomWater.update(1/30);});
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:`${output}/${backend}-merged.png`});
 const merged=await page.evaluate(()=>window.__wireTheHouse.roomWater.telemetry);
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.roomWater.addFloorWater(0,0,1500);for(let i=0;i<3600;i++)g.roomWater.update(1/30);});
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
 await page.screenshot({path:`${output}/${backend}-flood.png`});
 const flood=await page.evaluate(()=>{const g=window.__wireTheHouse;let maximumY=0;const p=g.roomWater.surfaceGeometry.getAttribute('position');for(let i=0;i<p.count;i++)maximumY=Math.max(maximumY,p.getY(i));return{...g.roomWater.telemetry,geometryMaxY:maximumY};});
 assert.ok(flood.geometryMaxY>.05,'rendered finite geometry rises with flood volume');assert.ok(flood.wetAreaM2>29,'water covers the room floor');assert.ok(Math.abs(flood.conservationErrorLitres)<1e-5);
 report.push({backend,...state,hose,merged,flood,errors});console.log(JSON.stringify(report.at(-1)));
 assert.equal(state.water.active,true);assert.equal(state.water.backend,backend);
 assert.ok(state.water.floorLitres>21.99);assert.ok(Math.abs(state.water.conservationErrorLitres)<1e-6);assert.equal(state.error,'');assert.deepEqual(errors,[]);
 await page.close();
}
}finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();}
