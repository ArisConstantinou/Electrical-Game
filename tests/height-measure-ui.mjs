import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/height-measure-ui';
await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,fixture:'Only camera position/pitch and the simulation clock are fixtures. Real wall rays, reach, tape, pencil marks and damage remain active. Native keyboard/touch select, mark, crouch and move; mobile view swipes also change the live reading. Automated Pointer Lock is rejected.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const step=(page,n=3)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__heightStep(1/60,1/60,false);},n);
const press=async(page,selector,mobile)=>{await page.locator(selector)[mobile?'tap':'click']();await step(page);};
async function tool(page,kind,mobile){
  if(mobile)await press(page,`[data-tool="${kind}"]`,true);
  else {await page.keyboard.press(kind==='measure'?'Digit9':'Digit4');await step(page);}
  await step(page,45);await page.waitForTimeout(1600);
}
async function aim(page,x=-.8,y=1.2,distance=.46){
  await page.evaluate(({x,y,distance})=>{
    const g=window.__wireTheHouse,c=g.renderer.camera;
    c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);
    c.lookAt(x,y,g.room.brickWall.volume.frontZ);
    g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
    g.player.workPosition.locked=false;g.player.workPosition.released=false;
  },{x,y,distance});
  await step(page,90);
}
const state=page=>page.evaluate(()=>{
  const g=window.__wireTheHouse,m=g.heightMeasure,render=JSON.parse(window.render_game_to_text());
  const rect=selector=>{const e=document.querySelector(selector),b=e?.getBoundingClientRect();return b?{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height,font:parseFloat(getComputedStyle(e).fontSize)}:null;};
  const tape=m.root.getObjectByName('Yellow millimetre tape, centimetres from floor');
  const outlet=g.fpsRig.getObjectByName('tape-blade-outlet');
  return{measurement:m.telemetry,renderMeasurement:render.measurement,selected:g.selectedTool,
    readout:document.querySelector('#measure-height')?.textContent,disabled:document.querySelector('#measure-mark')?.disabled,
    tape:tape?{bottom:tape.position.y-tape.scale.y/2,top:tape.position.y+tape.scale.y/2}:null,outlet:outlet?.getWorldPosition(g.renderer.camera.position.clone()).toArray(),
    markObjects:m.marksRoot.children.map(o=>({name:o.name,visible:o.visible,position:o.position.toArray()})),
    removed:g.room.brickWall.volume.removedVolume,eyeHeight:g.renderer.camera.position.y,crouched:g.player.crouched,camera:g.renderer.camera.position.toArray(),pose:g.fpsRig.debugPose(),
    held:g.input.actionHeld,layout:{panel:rect('#measure-panel'),height:rect('#measure-height'),mark:rect('#measure-mark'),joystick:rect('#joystick'),viewport:{width:innerWidth,height:innerHeight}},
    overflow:document.documentElement.scrollWidth>innerWidth,locked:!!document.pointerLockElement,error:g.renderer.renderError};
});
async function shot(page,name){
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
  await page.screenshot({path:`${out}/${name}.png`});
}
async function heldUse(page,mobile,cancel=false){
  if(!mobile){await page.keyboard.down('KeyE');await step(page,120);await page.keyboard.up('KeyE');}
  else {
    const b=await page.locator('#look-joystick').boundingBox(),cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:31}]});
    await step(page,120);
    await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await cdp.detach();
  }
  await step(page,3);
}
function checkLayout(s,mobile){
  assert.equal(s.overflow,false,'No horizontal page overflow');
  for(const key of ['height','mark']){
    const b=s.layout[key],v=s.layout.viewport;
    assert(b&&b.width>0&&b.height>0,`${key} is visible`);
    assert(b.x>=0&&b.y>=0&&b.right<=v.width+.5&&b.bottom<=v.height+.5,`${key} stays inside viewport`);
    assert(b.font>=12,`${key} text is readable`);
  }
  if(mobile){const b=s.layout.mark,j=s.layout.joystick;assert(b.right<=j.x||j.right<=b.x||b.bottom<=j.y||j.bottom<=b.y,'Mark control does not cover movement joystick');}
}
try {
  for(const [name,viewport,mobile] of [['desktop',{width:1366,height:768},false],['mobile',{width:390,height:844},true],['landscape',{width:844,height:390},true]]){
    if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==name)continue;
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);await serveTaskBuild(context,url);
    try {
      const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));await page.routeWebSocket('**',()=>{});
      await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.heightMeasure&&window.__wireTheHouse?.roomWater.waterProActive,undefined,{timeout:120000});
      await page.locator('#start-button')[mobile?'tap':'click']();await page.locator('#start-screen').waitFor({state:'hidden'});
      await page.evaluate(async()=>{const g=window.__wireTheHouse;window.__heightStep=g.step.bind(g);g.step=()=>{};await g.renderer.waitForFrame();});
      await tool(page,'measure',mobile);await aim(page);
      const ready=await state(page);await writeFile(`${out}/${name}-initial.json`,JSON.stringify(ready,null,2));await shot(page,`${name}-initial`);assert.equal(ready.selected,'measure');assert.equal(ready.measurement.mode,'ready');assert.equal(ready.measurement.heightM,1.2);
      assert.match(ready.readout,/1[.,]20/);assert.equal(ready.measurement.count,0);assert.equal(ready.disabled,false);
      assert(ready.measurement.visible&&ready.tape);assert(Math.abs(ready.tape.bottom)<1e-8,'Tape starts at floor');assert.equal(ready.tape.top,1.2,'Tape ends at the measured hand height');checkLayout(ready,mobile);
      assert.equal(ready.pose.reachable,true,'The actual gripping wrist reaches the case');assert(Math.abs(ready.outlet[0]-ready.measurement.target[0])<1e-6&&Math.abs(ready.outlet[1]-ready.measurement.target[1])<1e-6,'Case outlet aligns with the vertical measuring tape');
      assert.deepEqual(ready.renderMeasurement,ready.measurement,'Public render telemetry exposes live measurement');
      await shot(page,`${name}-live-120`);
      await heldUse(page,mobile);assert.equal((await state(page)).measurement.count,0,'Holding USE never creates pencil marks');
      if(mobile){await heldUse(page,true,true);assert.equal((await state(page)).measurement.count,0,'Cancelled USE never creates a pencil mark');await press(page,'#measure-mark',true);}
      else {await page.keyboard.down('KeyM');await step(page,120);await page.keyboard.down('KeyM');await step(page,30);await page.keyboard.up('KeyM');await step(page);}
      const marked=await state(page);assert.equal(marked.measurement.count,1,'One mark press creates exactly one pencil mark');assert.equal(marked.measurement.marks[0].heightM,1.2);assert.equal(marked.removed,ready.removed,'Pencil marking never cuts masonry');
      await shot(page,`${name}-pencil-120`);
      await tool(page,'hammer',mobile);const hammer=await state(page);assert.equal(hammer.measurement.mode,'hidden');assert.equal(hammer.measurement.count,1);assert(hammer.markObjects[0].visible);assert.equal(hammer.removed,ready.removed,'Selecting the hammer does not cut the pencil target');
      await shot(page,`${name}-persistent-pencil-hammer`);
      await tool(page,'measure',mobile);await aim(page,-.4,1.35);
      const secondReady=await state(page);assert.equal(secondReady.measurement.mode,'ready');assert.equal(secondReady.measurement.heightM,1.35);
      if(mobile)await press(page,'#measure-mark',true);else{await page.keyboard.press('KeyM');await step(page);}
      const two=await state(page);assert.equal(two.measurement.count,2);assert.deepEqual(two.measurement.marks[0],marked.measurement.marks[0],'Moving the tape preserves the first wall mark');
      await aim(page,-.8,.8);const lowStanding=await state(page);assert.equal(lowStanding.measurement.heightM,.8);assert.equal(lowStanding.measurement.mode,'ready');
      if(mobile)await press(page,'#quick-work-height',true);else{await page.keyboard.down('ControlLeft');await step(page,90);}
      await aim(page,-.8,.8);const crouched=await state(page);await writeFile(`${out}/${name}-crouched.json`,JSON.stringify(crouched,null,2));
      assert(crouched.eyeHeight<1.05,'Native crouch lowers eye height');assert.equal(crouched.measurement.heightM,lowStanding.measurement.heightM,'Floor reference is unchanged when crouched');assert.equal(crouched.measurement.mode,'ready');assert.equal(crouched.tape.bottom,0);
      await shot(page,`${name}-crouched-080`);
      if(mobile)await press(page,'#quick-work-height',true);else{await page.keyboard.up('ControlLeft');await step(page,90);}
      await aim(page,-.8,1.2);
      let nativeAim=null;
      if(mobile){
        const cdp=await context.newCDPSession(page),x=viewport.width*.75,y=viewport.height*.5;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:42}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-45,id:42}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await step(page,60);
        nativeAim=await state(page);assert.notEqual(nativeAim.measurement.heightM,1.2,'Native swipe updates height without pressing USE');assert.equal(nativeAim.measurement.count,2);
      }
      await aim(page,-.8,1.2,2);const far=await state(page);assert.equal(far.measurement.mode,'out-of-reach');assert.equal(far.disabled,true);assert.equal(far.measurement.visible,false);
      await page.keyboard.press('KeyM');await step(page);assert.equal((await state(page)).measurement.count,2,'Out-of-reach mark is rejected');await shot(page,`${name}-out-of-reach`);
      const final=await state(page);assert.equal(final.removed,ready.removed);assert.equal(final.locked,false);assert.equal(final.error,'');assert.equal(final.held,false);
      report.cases.push({name,viewport,ready,marked,hammer,secondReady,two,lowStanding,crouched,nativeAim,far,final});console.log(JSON.stringify({platform:name,passed:true,marks:two.measurement.marks}));
    } finally {await context.close();}
  }
  assert.deepEqual(report.errors,[]);
} finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,platforms:report.cases.map(c=>c.name)}));
