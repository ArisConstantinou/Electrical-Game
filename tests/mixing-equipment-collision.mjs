import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const vite=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
  const THREE=await vite.ssrLoadModule('/node_modules/three/build/three.module.js');
  const {resolveEquipmentCollisions}=await vite.ssrLoadModule('/src/player/EquipmentCollision.ts');
  const obstacle={id:'bench',minX:-.5,maxX:.5,minZ:-.2,maxZ:.2},radius=.28;
  const straight=new THREE.Vector3(0,1.65,-1);
  for(let i=0;i<20;i++){straight.z+=.08;resolveEquipmentCollisions(straight,radius,[obstacle]);}
  assert(Math.abs(straight.z-(obstacle.minZ-radius))<1e-8,'Player cannot tunnel through a thin footprint');
  const slide=new THREE.Vector3(-.9,1.65,-.55);
  for(let i=0;i<36;i++){slide.x+=.05;slide.z+=.05;resolveEquipmentCollisions(slide,radius,[obstacle]);}
  assert(slide.x>obstacle.maxX+radius||slide.z>obstacle.maxZ+radius,'Diagonal movement slides around the obstacle instead of sticking');
  const closestX=Math.max(obstacle.minX,Math.min(obstacle.maxX,slide.x)),closestZ=Math.max(obstacle.minZ,Math.min(obstacle.maxZ,slide.z));
  assert(Math.hypot(slide.x-closestX,slide.z-closestZ)>=radius-1e-8,'Sliding preserves body clearance');
}finally{await vite.close();}

const url=process.env.QA_BASE??'http://127.0.0.1:5365/Electrical-Game/',out='output/mixing-equipment-collision';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={url,errors:[],obstacles:[],contacts:[],passed:false};
try{
  const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});await page.locator('#start-button').click();
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.__collisionStep=g.step.bind(g);g.step=()=>{};});
  const step=(count=1)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__collisionStep(1/60);},count);await step(2);
  report.obstacles=await page.evaluate(()=>window.__wireTheHouse.mixing.collisionObstacles());
  const required=['wheelbarrow','concrete-mixer','mixing-bucket','sand-pile','cement-sack-1','shovel','cordless-mixer','rinse-pail','water-jug','mixing-trowel'];
  assert.deepEqual(report.obstacles.map(o=>o.id).sort(),required.sort(),'Every visible mixing object owns one physical footprint');
  for(const obstacle of report.obstacles){assert(obstacle.maxX>obstacle.minX&&obstacle.maxZ>obstacle.minZ,`${obstacle.id} has a non-empty footprint`);assert(obstacle.minX>=-3.8&&obstacle.maxX<=3.8&&obstacle.minZ>=-3.6&&obstacle.maxZ<=3.6,`${obstacle.id} footprint stays in the room`);}
  report.contacts=await page.evaluate(()=>{
    const g=window.__wireTheHouse,radius=.28,results=[];
    for(const obstacle of g.mixing.collisionObstacles()){
      g.player.setObstacleProvider(()=>[obstacle]);g.renderer.camera.position.set((obstacle.minX+obstacle.maxX)/2,g.player.eyeHeight,(obstacle.minZ+obstacle.maxZ)/2);g.player.update(0);
      const p=g.renderer.camera.position,closestX=Math.max(obstacle.minX,Math.min(obstacle.maxX,p.x)),closestZ=Math.max(obstacle.minZ,Math.min(obstacle.maxZ,p.z)),clearance=Math.hypot(p.x-closestX,p.z-closestZ);
      results.push({id:obstacle.id,position:[p.x,p.z],clearance,contacts:[...g.player.collisionContacts]});
    }
    g.player.setObstacleProvider(()=>g.mixing.collisionObstacles());return results;
  });
  for(const result of report.contacts){assert(result.clearance>=.28-1e-6,`${result.id} pushes the full player body outside`);assert(result.contacts.includes(result.id),`${result.id} reports physical contact`);}
  const sweep=await page.evaluate(()=>{
    const g=window.__wireTheHouse,o=g.mixing.collisionObstacles().find(item=>item.id==='wheelbarrow'),radius=.28,c=g.renderer.camera;
    g.player.setObstacleProvider(()=>[o]);c.position.set((o.minX+o.maxX)/2,g.player.eyeHeight,o.minZ-radius-.08);g.player.yaw=Math.PI;g.player.pitch=0;g.input.mobileMove={x:0,y:-1};
    for(let i=0;i<90;i++)window.__collisionStep(1/60);g.input.mobileMove={x:0,y:0};return{position:[c.position.x,c.position.z],limit:o.minZ-radius,contacts:[...g.player.collisionContacts],renderError:g.renderer.renderError};
  });
  assert(sweep.position[1]<=sweep.limit+1e-6,'Sustained forward movement cannot pass through the wheelbarrow');assert(sweep.contacts.includes('wheelbarrow'));assert.equal(sweep.renderError,'');
  await page.evaluate(async()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,p=m.models.wheelbarrow.group.getWorldPosition(c.position.clone());c.lookAt(p.x,p.y+.48,p.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/wheelbarrow-contact.png`});
  const dynamic=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing;m.setActive(true);m.chooseTool('water');m.present();const held=m.collisionObstacles().some(o=>o.id==='water-jug');m.chooseTool('hands');m.present();const returned=m.collisionObstacles().some(o=>o.id==='water-jug');return{held,returned};});
  assert.equal(dynamic.held,false,'Picked-up tools stop blocking their empty floor position');assert.equal(dynamic.returned,true,'Put-down tools become physical again');
  const approachStarted=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,b=m.models.bucket.getWorldPosition(c.position.clone());g.player.setObstacleProvider(()=>m.collisionObstacles());c.position.set(b.x,g.player.eyeHeight,b.z-.92);c.lookAt(b.x,b.y+.3,b.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;m.setActive(true);m.chooseTool('mixer');return m.action('insert');});
  assert.equal(approachStarted,true);await step(60);const mixerApproach=await page.evaluate(()=>({mixing:window.__wireTheHouse.mixing.telemetry,contacts:[...window.__wireTheHouse.player.collisionContacts]}));
  assert.equal(mixerApproach.mixing.inserted,true,`Physical bucket clearance still permits the assisted mixer stance: ${JSON.stringify(mixerApproach)}`);
  const performance=await page.evaluate(()=>{const m=window.__wireTheHouse.mixing;for(let i=0;i<100;i++)m.collisionObstacles();const start=performance.now();for(let i=0;i<2000;i++)m.collisionObstacles();return{meanMs:(performance.now()-start)/2000,count:m.collisionObstacles().length};});
  assert(performance.meanMs<.25,`Equipment footprint update stays below 0.25 ms/frame, got ${performance.meanMs.toFixed(4)} ms`);
  assert.deepEqual(report.errors,[]);report.passed=true;report.sweep=sweep;report.dynamic=dynamic;report.mixerApproach=mixerApproach;report.performance=performance;console.log(JSON.stringify({passed:true,obstacles:report.obstacles.map(o=>o.id),sweep,dynamic,mixerInserted:mixerApproach.mixing.inserted,performance}));await context.close();
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
