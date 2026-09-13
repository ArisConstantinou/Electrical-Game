import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/tool-poses-contact';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,fixture:'Deterministic camera/angle matrix. Each case restores the real pristine masonry save, settles production Game.step, and strikes through BrickWall.removeAtAim and the real FPS contact provider. Native input is covered separately by shared-tool-view-ui.',cases:[],errors:[]};
try{
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  await blockPointerLock(page.context());
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse,{timeout:120000});
  await page.locator('#start-button').click();await page.waitForTimeout(650);await page.keyboard.press('Digit4');
  await page.evaluate(()=>{document.exitPointerLock();const g=window.__wireTheHouse;window.__poseStep=g.step.bind(g);g.step=()=>{};window.__pristineWall=g.room.brickWall.volume.serialize();});
  const fixtures=[];
  for(const y of [.65,1.3,1.8])for(const tilt of [-55,-35,-15,0,15,35,55])for(const side of [-45,0,45])fixtures.push({y,tilt,side,yaw:0});
  for(const yaw of [-65,-45,45,65])for(const tilt of [-30,15,45])fixtures.push({y:1.3,tilt,side:Math.sign(yaw)*25,yaw});
  for(const fixture of fixtures){
    const result=await page.evaluate(({y,tilt,side,yaw})=>{
      const g=window.__wireTheHouse,c=g.renderer.camera,w=g.room.brickWall,r=g.fpsRig;
      w.volume.restore(window.__pristineWall);w.flushGeometry();
      g.hammerWorkStance.restore(c);g.player.workPosition.locked=false;g.player.workPosition.released=false;
      // An oblique fixture starts beside the wall. Starting 65 degrees from
      // a metre away instead selects a target over two metres to the side,
      // which should require walking rather than stretching the worker.
      c.position.set(0,1.65,yaw?w.volume.frontZ+.46:-1.4);c.lookAt(0,y,w.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
      if(yaw)g.player.yaw=yaw*Math.PI/180;
      w.chiselTiltDegrees=tilt;w.chiselSideDegrees=side;
      for(let i=0;i<180;i++)window.__poseStep(1/60);
      const contact=r.contact(c,w),initial={contact:!!contact,pose:r.debugPose(),fit:structuredClone(r.hammerFit),headLean:r.workHeadLeanM,actualTilt:r.actualTiltDegrees};
      let successes=0;
      for(let strike=0;strike<10;strike++){if(w.removeAtAim(c,true))successes++;for(let i=0;i<15;i++)window.__poseStep(1/60);}
      return{...initial,successes,removed:w.volume.removedNodeCount,finalContact:!!r.contact(c,w),finalPose:r.debugPose()};
    },fixture);
    report.cases.push({...fixture,...result});
  }
  const length=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  for(const s of report.cases){
    const label=`height ${s.y}, tilt ${s.tilt}, side ${s.side}, view yaw ${s.yaw}`;
    assert(s.contact,`${label}: no initial physical contact (${JSON.stringify(s.fit)})`);
    assert(s.removed>0,`${label}: ten real strikes did not remove masonry`);
    for(const pose of [s.pose,s.finalPose])for(const a of pose.arms){assert(Math.abs(length(a.shoulder,a.elbow)-.31)<1e-6,`${label}: stretched upper arm`);assert(Math.abs(length(a.elbow,a.wrist)-.27)<1e-6,`${label}: stretched forearm`);assert.equal(a.fingers,5);}
    const main=s.pose.arms.find(a=>a.gripRole==='rear');assert(main,`${label}: no main grip`);
    if(s.headLean>.04)assert.equal(main.side,-1,`${label}: right lean must swap to the left main hand`);
    if(s.headLean<.015)assert.equal(main.side,1,`${label}: straight/left lean uses the right main hand`);
  }
  assert.deepEqual(report.errors,[]);
  console.log(JSON.stringify({cases:report.cases.length,contact:report.cases.filter(s=>s.contact).length,realRemoval:report.cases.filter(s=>s.removed>0).length,minRemoved:Math.min(...report.cases.map(s=>s.removed)),errors:report.errors}));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
