import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.argv[3]??'output/laser-level-ui';await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,fixture:'Only camera position and deterministic game steps prepare native interactions. Actual room wall rays, tool reach, pencil marks, drill/fasten timings and laser placement remain active. A saved-node masonry cut tests a real through-hole. Paired renders temporarily disable only the mounted laser illumination to locate actual projected pixels. Pointer Lock is rejected.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const steps=(page,n=3)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__laserStep(1/60,1/60,false);},n);
const keys={measure:'Digit9',drill:'Digit0',laser:'KeyL',driver:'KeyB',hammer:'Digit4'};
async function select(page,tool,mobile){
  if(mobile)await page.locator(`[data-tool="${tool}"]`).tap();else await page.keyboard.press(keys[tool]);
  await steps(page,60);await page.waitForTimeout(1300);
}
async function aim(page,kind='side',height=1.2,distance=.43){
  await page.evaluate(({kind,height,distance})=>{
    const g=window.__wireTheHouse,c=g.renderer.camera;
    g.hammerWorkStance.restore(c);
    if(kind==='side'){c.position.set(-3+distance,g.player.eyeHeight,0);c.lookAt(-3,height,0);}
    else{c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);c.lookAt(0,height,g.room.brickWall.volume.frontZ);}
    g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
    g.player.workPosition.locked=false;g.player.workPosition.released=false;
  },{kind,height,distance});await steps(page,90);
}
async function hold(page,mobile,n){
  if(mobile){
    const b=await page.locator('#look-joystick').boundingBox(),cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:77}]});
    await steps(page,n);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }else{await page.keyboard.down('KeyE');await steps(page,n);await page.keyboard.up('KeyE');}
  await steps(page,3);
}
const state=page=>page.evaluate(()=>{
  const g=window.__wireTheHouse,r=JSON.parse(window.render_game_to_text());
  const rectangle=selector=>{const e=document.querySelector(selector),b=e?.getBoundingClientRect();return b?{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height,font:parseFloat(getComputedStyle(e).fontSize)}:null;};
  return{selected:g.selectedTool,measure:g.heightMeasure.telemetry,laser:g.laserLevel.telemetry,renderLaser:r.laser,activeHeight:g.laserLevel.activeHeightM,
    device:{visible:g.laserLevel.device.visible,position:g.laserLevel.device.position.toArray(),quaternion:g.laserLevel.device.quaternion.toArray()},
    placeDisabled:document.querySelector('#laser-place')?.disabled,pose:g.fpsRig.debugPose(),held:g.input.actionHeld,removed:g.room.brickWall.volume.removedVolume,
    layout:{panel:rectangle('#laser-panel'),height:rectangle('#laser-work-height'),place:rectangle('#laser-place'),viewport:{width:innerWidth,height:innerHeight}},
    overflow:document.documentElement.scrollWidth>innerWidth,error:g.renderer.renderError,locked:!!document.pointerLockElement};
});
async function shot(page,name){
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
  return page.screenshot({path:`${out}/${name}.png`});
}
async function mark(page,mobile){if(mobile)await page.locator('#measure-mark').tap();else await page.keyboard.press('KeyM');await steps(page,12);}
async function mount(page,mobile){await page.locator('#laser-place')[mobile?'tap':'click']();await steps(page,6);}
function layoutCheck(s){
  assert(!s.overflow,'No horizontal overflow');
  for(const id of ['height','place']){const b=s.layout[id],v=s.layout.viewport;assert(b&&b.width>0&&b.height>0);assert(b.x>=0&&b.y>=0&&b.right<=v.width+.5&&b.bottom<=v.height+.5,`${id} inside viewport`);assert(b.font>=12,`${id} readable`);}
}
async function laserPixels(page,name){
  const on=await shot(page,`${name}-on`);
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.laserLevel.setActive(false);window.__laserStep(0,0,false);});
  const off=await shot(page,`${name}-off`);
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.laserLevel.setActive(true);window.__laserStep(0,0,false);});
  return page.evaluate(async({on,off})=>{
    async function pixels(b64){const image=await createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'}));const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);image.close();return{width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};}
    const a=await pixels(on),b=await pixels(off),g=window.__wireTheHouse,c=g.renderer.renderCamera;
    function scan(x0,x1,y0,y1){
      const points=[];for(const x of [x0,x1])for(const y of [y0,y1]){const p=c.position.clone().set(x,y,g.room.brickWall.volume.frontZ+.001).project(c);points.push([(p.x+1)*a.width/2,(1-p.y)*a.height/2]);}
      const bounds={x0:Math.max(0,Math.ceil(Math.min(...points.map(p=>p[0])))),x1:Math.min(a.width,Math.floor(Math.max(...points.map(p=>p[0])))),y0:Math.max(0,Math.ceil(Math.min(...points.map(p=>p[1])))),y1:Math.min(a.height,Math.floor(Math.max(...points.map(p=>p[1]))))};
      // At landscape resolution the physical 3 mm line is antialiased into the orange clay.
      // Measure its added green component against the same scene without illumination.
      let green=0,changed=0;for(let y=bounds.y0;y<bounds.y1;y++)for(let x=bounds.x0;x<bounds.x1;x++){const i=(y*a.width+x)*4,d=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);if(d>35){changed++;if(a.data[i+1]-b.data[i+1]>15&&(a.data[i+1]-a.data[i])-(b.data[i+1]-b.data[i])>15)green++;}}
      return{green,changed,bounds};
    }
    return{wall:scan(-.60,-.25,1.18,1.22),centre:scan(-.05,.05,1.185,1.215)};
  },{on:on.toString('base64'),off:off.toString('base64')});
}
async function cutThroughHole(page){
  return page.evaluate(async()=>{
    const g=window.__wireTheHouse,v=g.room.brickWall.volume,save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
    for(let x=Math.max(1,Math.floor((-.15+v.width/2)/v.hx));x<=Math.ceil((.15+v.width/2)/v.hx)+1;x++)for(let y=Math.floor(1.10/v.hy);y<=Math.ceil(1.30/v.hy)+1;y++)for(let z=1;z<=v.nz;z++){
      const p=v.nodePosition(x,y,z);if(Math.abs(p.x)>.15||Math.abs(p.y-1.2)>.1||!v.nodeMaterial(x,y,z))continue;
      const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,index=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
      if(!chunks.has(key))chunks.set(key,new Map());if(!chunks.get(key).has(index)){chunks.get(key).set(index,[index,255,1]);removed++;}
    }
    save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();return{removed,ray:v.raycast({x:0,y:1.2,z:v.frontZ+.03},{x:0,y:0,z:-1},v.depth+.06)};
  });
}
try{
  for(const [name,viewport,mobile] of [['desktop',{width:1366,height:768},false],['mobile',{width:390,height:844},true],['landscape',{width:844,height:390},true]]){
    if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==name)continue;
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);await serveTaskBuild(context,url);
    const page=await context.newPage();
    try{
      page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));await page.routeWebSocket('**',()=>{});
      await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.laserLevel&&window.__wireTheHouse?.roomWater.waterProActive,null,{timeout:120000});
      await page.locator('#start-button')[mobile?'tap':'click']();await page.locator('#start-screen').waitFor({state:'hidden'});
      await page.evaluate(async()=>{const g=window.__wireTheHouse;window.__laserStep=g.step.bind(g);g.step=()=>{};await g.renderer.waitForFrame();});
      await select(page,'measure',mobile);await aim(page);const measured=await state(page);
      assert.equal(measured.measure.mode,'ready');assert.equal(measured.measure.heightM,1.2);assert(measured.measure.targetStable);await mark(page,mobile);
      const marked=await state(page);assert.equal(marked.measure.count,1);assert(marked.measure.marks[0].stable);await shot(page,`${name}-side-wall-pencil`);
      await select(page,'laser',mobile);const undrilled=await state(page);assert(!undrilled.laser.mounted&&!undrilled.laser.active);assert(undrilled.placeDisabled,'Native PLACE is disabled until drilling');await hold(page,mobile,2);assert.equal((await state(page)).laser.mounted,false,'USE cannot bypass missing fixing');
      await select(page,'drill',mobile);await aim(page,'side',1.2,1.8);const far=await state(page);assert.equal(far.laser.phase,'out-of-reach');await hold(page,mobile,60);assert.equal((await state(page)).laser.fixings.length,0,'Out-of-reach drilling cannot create a fixing');
      await aim(page);await hold(page,mobile,15);const partial=await state(page);assert(partial.laser.progress>0&&partial.laser.progress<1);
      await aim(page,'side',1.2,1.8);await hold(page,mobile,60);const paused=await state(page);assert.equal(paused.laser.fixings[0].progress,partial.laser.progress,'Progress stops after moving out of reach');
      await aim(page);await hold(page,mobile,50);const drilled=await state(page);assert.equal(drilled.laser.phase,'drilled');assert.equal(drilled.laser.fixings[0].progress,1);assert.equal(drilled.removed,measured.removed,'A fixing on the side wall does not demolish installation bricks');await shot(page,`${name}-prepared-fixing`);
      await select(page,'laser',mobile);const prepared=await state(page);assert.equal(prepared.laser.phase,'mount-ready');assert(!prepared.placeDisabled);layoutCheck(prepared);await mount(page,mobile);
      const mounted=await state(page);assert(mounted.laser.mounted&&mounted.device.visible);assert.equal(mounted.laser.active,false);assert.equal(mounted.activeHeight,null,'Hung laser remains inactive until its fixing is tightened');await page.waitForTimeout(1900);await shot(page,`${name}-hung-laser`);
      await select(page,'driver',mobile);await hold(page,mobile,50);const active=await state(page);assert.equal(active.laser.phase,'active');assert(active.laser.active);assert.equal(active.activeHeight,1.2);assert.deepEqual(active.renderLaser,active.laser);await shot(page,`${name}-secured-laser`);
      await select(page,'hammer',mobile);await aim(page,'brick',1.2,1.45);const transferred=await state(page);assert.equal(transferred.activeHeight,1.2);assert.deepEqual(transferred.device.position,active.device.position,'Reference device stays mounted when walking to the brick wall');
      const intactPixels=await laserPixels(page,`${name}-brick-reference`);assert(intactPixels.wall.green>20,`Laser must visibly light actual bricks: ${JSON.stringify(intactPixels)}`);
      const cut=await cutThroughHole(page);assert(cut.removed>0);assert.equal(cut.ray,null,'Cut fixture contains actual air through the full wall');await steps(page,12);
      const holePixels=await laserPixels(page,`${name}-chase-reference`);assert(holePixels.wall.green>20,'Remaining bricks retain the green reference');assert(holePixels.centre.green<=2,`Air must not carry a floating laser stripe: ${JSON.stringify(holePixels)}`);
      const final=await state(page);assert.equal(final.activeHeight,1.2);assert(final.measure.marks[0].stable&&final.measure.count===1);assert(!final.overflow&&!final.error&&!final.locked&&!final.held);
      // A concrete reference is convenient, but the player may also use intact brick.
      await aim(page);await select(page,'laser',mobile);await mount(page,mobile);assert.equal((await state(page)).laser.mounted,false,'Native PICK UP removes the existing laser');
      await select(page,'measure',mobile);await aim(page,'brick',1.45,.43);assert.equal((await state(page)).measure.mode,'ready');await mark(page,mobile);
      const brickMark=(await state(page)).measure.marks.at(-1);assert.equal(brickMark.stable,false);assert.equal(brickMark.heightM,1.45);
      await select(page,'drill',mobile);await hold(page,mobile,55);assert.equal((await state(page)).laser.phase,'drilled');
      await select(page,'laser',mobile);await mount(page,mobile);assert.equal((await state(page)).laser.mounted,true,'Mounting directly on a prepared brick fixing is allowed');
      await select(page,'driver',mobile);await hold(page,mobile,50);const brickActive=await state(page);assert.equal(brickActive.activeHeight,1.45);await shot(page,`${name}-brick-mounted-reference`);
      report.cases.push({name,viewport,measured,marked,undrilled,far,partial,paused,drilled,prepared,mounted,active,transferred,intactPixels,cut,holePixels,final,brickActive});console.log(JSON.stringify({platform:name,passed:true,height:final.activeHeight,brickHeight:brickActive.activeHeight,intactPixels,holePixels}));
    }catch(error){await writeFile(`${out}/${name}-failure.json`,JSON.stringify({error:String(error),state:await state(page).catch(()=>null)},null,2));await shot(page,`${name}-failure`).catch(()=>{});throw error;}finally{await context.close();}
  }
  assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,platforms:report.cases.map(c=>c.name)}));
