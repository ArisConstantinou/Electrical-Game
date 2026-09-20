import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const baseline=process.env.BASELINE==='1',out=`output/wheelbarrow-slosh/${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[],frames:[]};
try {
 const context=await browser.newContext({viewport:{width:1100,height:900}});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.routeWebSocket('**',()=>{});
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);
 await page.evaluate(()=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow;window.slumpStep=g.step.bind(g);g.step=()=>{};w.mortarSlump?.reset(3185);w.model.group.position.set(1.2,0,-.8);w.yaw=0;w.model.group.rotation.set(0,0,0);w.enter();});
 for(const [name,key,frames] of [['rest',null,90],['left','KeyA',30],['right','KeyD',60],['left-again','KeyA',60],['right-again','KeyD',60],['left-final','KeyA',60],['settle',null,180]]){
  if(key)await page.keyboard.down(key);
  const data=await page.evaluate(async({name,frames})=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow;for(let i=0;i<frames;i++)window.slumpStep(1/60);
   const p=w.model.mortar.geometry.getAttribute('position'),edges=[];for(let i=p.count-(w.model.mortar.geometry.userData.rimVertices??81);i<p.count;i++)edges.push([p.getX(i),p.getY(i),p.getZ(i)]);
   const left=edges.filter(p=>p[0]<-.25).map(p=>p[1]),right=edges.filter(p=>p[0]>.25).map(p=>p[1]);
   const center=w.model.group.localToWorld(g.renderer.camera.position.clone().set(0,.65,0));g.renderer.camera.position.copy(center).add({x:0,y:1.4,z:-1.25});g.renderer.camera.lookAt(center);g.renderer.render();await g.renderer.waitForFrame();
   const heights=Array.from({length:p.count},(_,i)=>p.getY(i)-.05*p.getZ(i));
   return{name,...w.telemetry,edgeDelta:right.reduce((a,b)=>a+b,0)/right.length-left.reduce((a,b)=>a+b,0)/left.length,relief:Math.max(...heights)-Math.min(...heights),edges};
  },{name,frames});if(key)await page.keyboard.up(key);report.frames.push(data);await page.screenshot({path:`${out}/${name}.png`});
  if(name==='left-final'){
   await page.evaluate(async()=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow,c=g.renderer.camera,center=w.model.group.localToWorld(c.position.clone().set(0,.65,0));c.position.copy(center).add({x:0,y:.93,z:-.43});c.lookAt(center);g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/detail.png`});
  }
 }
 assert.deepEqual(report.errors,[]);
 if(!baseline&&process.env.OBSERVE!=='1'){
  for(const f of report.frames)assert(Math.abs(f.totalKg-114)<1e-6);
  assert(report.frames.every(f=>f.relief>.025),'Mortar retains uneven lumps instead of a liquid plane');
  const moved=report.frames.flatMap(f=>f.slump.patches.map(p=>Math.hypot(...p.offset)));
  assert(Math.max(...moved)>.025,'Cohesive regions visibly slip');
  assert(report.frames.at(-1).floorKg>.05,'Rocking sheds recoverable clumps before overturning');assert(report.frames.every(f=>f.state==='driving'));
  assert(report.frames.slice(1,-1).some(f=>f.massKg<113.9),'Repeated rocking must shed clumps while still moving');
 }
 console.log(JSON.stringify(report.frames.map(({name,massKg,state,roll,slosh,edgeDelta,floorKg})=>({name,massKg,state,roll,slosh,edgeDelta,floorKg}))));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
