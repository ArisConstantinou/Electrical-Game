import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const tool=process.env.REVIEW_TOOL||'drill';
const out=process.env.REVIEW_OUTPUT||`output/reference-grip/${tool}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:900}});await blockPointerLock(ctx);const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();await p.waitForTimeout(650);
 await p.evaluate(tool=>{const g=window.__wireTheHouse;window.sampleStep=g.step.bind(g);g.step=()=>{};g.selectTool(tool);g.input.locked=false;},tool);
 for(const [name,pitch,yaw,crouch,distance] of [['straight',0,0,false,1.1],['down',-1.15,0,false,1.1],['up',1.15,0,false,1.1],['left',-.3,-.8,false,1.1],['right',-.3,.8,false,1.1],['crouch',-.8,.4,true,1.1],['near',0,0,false,.42]]){
  report.cases.push(await p.evaluate(async({name,pitch,yaw,crouch,distance})=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.player.workPosition.locked=false;g.player.workPosition.released=true;g.player.crouched=crouch;g.player.yaw=yaw;g.player.pitch=pitch;g.player.velocity.set(0,0,0);c.position.set(-.6,crouch?.95:1.65,g.room.brickWall.volume.frontZ+distance);g.renderer.viewCamera=null;w.overview=false;
   for(let i=0;i<65;i++)window.sampleStep(1/60);
   const grip=g.fpsRig.anatomicalGrips().find(x=>x.side===1),q=grip.rotation.clone().invert(),wrist=w.point('hand.R'),projected=wrist.clone().project(c),bounds=g.fpsRig.heldToolBoundsWorld(),front=g.workSurfaces.frontForBounds(bounds);
   const data={name,pitch,yaw,crouch,solve:w.userData.graspSolve,gripErrors:w.telemetry.gripReachErrors,relative:wrist.clone().sub(grip.center).applyQuaternion(q).toArray(),projected:projected.toArray(),bend:w.point('middle.01.R').sub(wrist).angleTo(wrist.clone().sub(w.point('forearm.R')))*180/Math.PI,localHand:q.clone().multiply(w.bone('hand.R').getWorldQuaternion(q.clone())).toArray(),visible:Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&projected.z>-1&&projected.z<1,wallPenetration:front===null?0:Math.max(0,front-bounds.min.z),reachable:g.fpsRig.reachable};
   g.renderer.render();await g.renderer.waitForFrame();return data;
  },{name,pitch,yaw,crouch,distance}));
  await p.screenshot({path:`${out}/${name}.png`});
  if(name==='down'||name==='straight'){
   await p.evaluate(async()=>{const g=window.__wireTheHouse,w=g.workerBody,v=g.modelInspector.camera,V=v.position.constructor;w.overview=true;const target=w.point('hand.R');v.position.copy(target).add(new V(.35,.15,.4));v.lookAt(target);v.aspect=1.6;v.fov=45;v.updateProjectionMatrix();g.renderer.viewCamera=v;g.renderer.render();await g.renderer.waitForFrame();});await p.screenshot({path:`${out}/${name}-close.png`});
  }
 }
 if(process.argv.includes('--verify')){assert.deepEqual(report.errors,[]);for(const c of report.cases){assert(c.visible,c.name+' wrist outside frustum');assert(c.gripErrors.R<.004,c.name+' detached hand');assert(Math.abs(c.bend-report.cases[0].bend)<.001,c.name+' changing wrist');assert(c.wallPenetration<.004,c.name+' tool through wall');}}
 console.log(JSON.stringify(report.cases.map(c=>({name:c.name,bend:c.bend,gap:c.gripErrors.R,visible:c.visible,wall:c.wallPenetration}))));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
