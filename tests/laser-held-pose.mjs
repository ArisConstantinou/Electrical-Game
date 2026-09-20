import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const out=process.argv[2]??'output/laser-held-pose';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[],scope:'Chromium desktop and portrait emulation; portrait is not physical-phone proof.'};
try{
  for(const [viewport,width,height,mobile] of [['desktop',1366,768,false],['portrait',390,844,true]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(`${viewport}: ${error.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await page.locator('#start-button')[mobile?'tap':'click']();
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__laserPoseStep=g.step.bind(g);g.step=()=>{};g.input.locked=false;g.selectTool('laser');g.player.velocity.set(0,0,0);});
    for(const [name,pitch,yaw] of [['level',0,Math.PI],['down',-.75,Math.PI],['up',.75,Math.PI],['left',0,Math.PI-.8],['right',0,Math.PI+.8]]){
      const result=await page.evaluate(async({viewport,name,pitch,yaw})=>{
        const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,V=c.position.constructor,Q=c.quaternion.constructor;
        g.player.pitch=pitch;g.player.yaw=yaw;for(let i=0;i<12;i++)window.__laserPoseStep(1/60);g.renderer.render();await g.renderer.waitForFrame();
        const point=n=>w.point(n+'.R'),shoulder=point('upper_arm'),elbow=point('forearm'),wrist=point('hand'),knuckle=point('middle.01');
        const upper=shoulder.clone().sub(elbow),fore=wrist.clone().sub(elbow),tool=g.fpsRig.tools.get('laser'),toolQ=tool.getWorldQuaternion(new Q()),up=new V(0,1,0).applyQuaternion(toolQ);
        const forward=c.getWorldDirection(new V());forward.y=0;forward.normalize();const face=new V(0,0,1).applyQuaternion(toolQ);
        return{viewport,name,elbowDegrees:upper.angleTo(fore)*180/Math.PI,wristBendDegrees:knuckle.sub(wrist).angleTo(wrist.clone().sub(elbow))*180/Math.PI,uprightDegrees:up.angleTo(new V(0,1,0))*180/Math.PI,facingDot:face.dot(forward.clone().negate()),reachError:w.telemetry.gripReachErrors.R,wristNdc:wrist.clone().project(c).toArray()};
      },{viewport,name,pitch,yaw});report.cases.push(result);
      assert(result.elbowDegrees>(name==='level'?155:105),`${viewport}/${name}: laser elbow remains folded at ${result.elbowDegrees.toFixed(1)} degrees`);
      assert(result.wristBendDegrees<1,`${viewport}/${name}: laser wrist bends ${result.wristBendDegrees.toFixed(1)} degrees`);
      assert(result.uprightDegrees<.1,`${viewport}/${name}: laser tilts ${result.uprightDegrees.toFixed(1)} degrees`);
      assert(result.facingDot>.999,`${viewport}/${name}: laser no longer faces the player`);assert(result.reachError<.001);assert(Math.abs(result.wristNdc[0])<1&&Math.abs(result.wristNdc[1])<1&&Math.abs(result.wristNdc[2])<1,`${viewport}/${name}: laser hand leaves the camera frame`);
    }
    await context.close();
  }
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({passed:true,cases:report.cases.length,minElbowDegrees:Math.min(...report.cases.map(c=>c.elbowDegrees)),maxTiltDegrees:Math.max(...report.cases.map(c=>c.uprightDegrees)),maxWristBendDegrees:Math.max(...report.cases.map(c=>c.wristBendDegrees))}));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
