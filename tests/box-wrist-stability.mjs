import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const out=process.argv[2]??'output/box-wrist-stability';await mkdir(out,{recursive:true});
const report={cases:[],motion:[],performance:[],errors:[],scope:'Headless desktop WebGL and portrait viewport emulation; CPU submission is not GPU timing or physical mobile performance.'};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [name,width,height] of [['desktop',1440,900],['portrait',390,844]]){
  const context=await browser.newContext({viewport:{width,height}});await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await page.locator('#start-button').click();
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.boxStep=g.step.bind(g);g.step=()=>{};g.input.locked=false;g.selectTool('fitting');g.player.velocity.set(0,0,0);g.player.workPosition.locked=false;g.player.workPosition.released=true;});
  for(const [pitch,yaw] of [[0,0],[-.6,0],[-1.15,0],[1.15,0],[-.6,-.8],[-.6,.8]]){
   const result=await page.evaluate(async({pitch,yaw})=>{
    const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.player.pitch=pitch;g.player.yaw=yaw;c.position.set(-.6,1.65,g.room.brickWall.volume.frontZ+1.1);
    for(let i=0;i<40;i++)window.boxStep(1/60);g.renderer.render();await g.renderer.waitForFrame();
    const arms=g.fpsRig.anatomicalGrips().filter(g=>g.active).map(grip=>{
     const side=grip.side>0?'R':'L',wrist=w.point('hand.'+side),elbow=w.point('forearm.'+side),q=grip.rotation.clone().invert().multiply(w.bone('hand.'+side).getWorldQuaternion(c.quaternion.clone()));
     return{side,bend:w.point('middle.01.'+side).sub(wrist).angleTo(wrist.clone().sub(elbow))*180/Math.PI,handInGrip:q.toArray(),reachError:w.telemetry.gripReachErrors[side]};
    });
    return{pitch,yaw,arms};
   },{pitch,yaw});report.cases.push({viewport:name,...result});
   if(yaw===0)await page.screenshot({path:`${out}/${name}-${pitch}.png`});
  }
  report.motion.push(await page.evaluate(name=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,previous=new Map();let maxStep=0,maxBend=0,maxReachError=0;
   g.player.pitch=-1.15;g.player.yaw=-.8;for(let i=0;i<40;i++)window.boxStep(1/60);
   for(let i=0;i<=90;i++){
    g.player.pitch=-1.15+2.3*i/90;g.player.yaw=-.8+1.6*i/90;window.boxStep(1/60);
    for(const side of ['L','R']){const q=w.bone('hand.'+side).getWorldQuaternion(c.quaternion.clone()),old=previous.get(side);if(old)maxStep=Math.max(maxStep,old.angleTo(q)*180/Math.PI);previous.set(side,q);
     const wrist=w.point('hand.'+side);maxBend=Math.max(maxBend,w.point('middle.01.'+side).sub(wrist).angleTo(wrist.clone().sub(w.point('forearm.'+side)))*180/Math.PI);maxReachError=Math.max(maxReachError,w.telemetry.gripReachErrors[side]);}
   }
   return{viewport:name,maxStep,maxBend,maxReachError};
  },name));
  report.performance.push(await page.evaluate(async name=>{
   const g=window.__wireTheHouse,times=[],frames=[];let last=performance.now();
   g.player.pitch=-.6;g.player.yaw=.8;g.renderer.camera.position.set(-.6,1.65,g.room.brickWall.volume.frontZ+1.1);
   for(let i=0;i<40;i++)window.boxStep(1/60);
   for(let i=0;i<50;i++){await new Promise(requestAnimationFrame);const start=performance.now();window.boxStep(1/60);g.renderer.render();await g.renderer.waitForFrame();if(i>=10){times.push(performance.now()-start);frames.push(start-last);}last=start;}
   times.sort((a,b)=>a-b);frames.sort((a,b)=>a-b);
   return{viewport:name,submitMedianMs:times[20],submitP95Ms:times[38],frameP95Ms:frames[38],frameMaxMs:frames[39],render:{...g.renderer.webgl.info.render},browser:navigator.userAgent,cores:navigator.hardwareConcurrency};
  },name));await context.close();
 }
 assert.deepEqual(report.errors,[]);
 for(const m of report.motion){assert(m.maxBend<1);assert(m.maxReachError<.002);assert(m.maxStep<15,`${m.viewport}: camera sweep causes ${m.maxStep.toFixed(1)} degree hand jump`);}
 for(const c of report.cases)for(const arm of c.arms){
  assert(arm.bend<1,`${c.viewport}, pitch ${c.pitch}, yaw ${c.yaw}: ${arm.side} wrist bends ${arm.bend.toFixed(1)} degrees`);
  assert(arm.reachError<.002,`${c.viewport}: ${arm.side} loses grip contact`);
  const ref=report.cases.find(r=>r.viewport===c.viewport).arms.find(a=>a.side===arm.side).handInGrip;
  const dot=Math.min(1,Math.abs(ref.reduce((n,v,i)=>n+v*arm.handInGrip[i],0)));
  assert(2*Math.acos(dot)<.02,`${c.viewport}: ${arm.side} grip changes with camera rotation`);
 }
 console.log(JSON.stringify({passed:true,cases:report.cases.length,performance:report.performance}));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
