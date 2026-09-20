import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {blockPointerLock} from './browser-safety.mjs';
const out=`output/camera-grip/${process.argv[2]??'before'}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});await blockPointerLock(context);const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 if(process.argv.includes('--baseline'))for(const file of ['WorkerBody','FPSRig']){
  const original=await readFile(`output/camera-grip/before/${file}.ts`,'utf8');
  await p.route(`**/src/player/${file}.ts*`,async route=>{
   const response=await route.fetch(),live=await response.text();
   let code=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/Electrical-Game/'));
   code=code.replace(/from ["']([^"']+)["']/g,(match,spec)=>{
    if(spec==='three')return `from ${JSON.stringify(live.match(/import \* as THREE from ["']([^"']+)/)[1])}`;
    if(spec==='three/addons/loaders/GLTFLoader.js')return `from ${JSON.stringify(live.match(/import \{ GLTFLoader \} from ["']([^"']+)/)[1])}`;
    if(spec.startsWith('.'))return `from ${JSON.stringify(new URL(spec+'.ts',route.request().url()).pathname)}`;
    return match;
   });await route.fulfill({response,body:code,contentType:'application/javascript'});
  });
 }
 await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();
 await p.evaluate(()=>{const g=window.__wireTheHouse;window.diagnosticStep=g.step.bind(g);g.step=()=>{};g.selectTool('fitting');g.fpsRig.setFittingBoxKinds(['2G','1G']);});
 for(const [name,pitch,yaw] of [['ceiling',1,0],['up',.5,0],['straight',0,0],['down',-.8,0],['right',0,.6],['left',0,-.6],['near',0,0]]){
  report.cases.push(await p.evaluate(async({name,pitch,yaw})=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.player.crouched=false;g.player.velocity.set(0,0,0);g.player.yaw=yaw;g.player.pitch=pitch;c.position.set(-.6,1.65,g.room.brickWall.volume.frontZ+1.1);g.renderer.viewCamera=null;w.overview=false;
   if(name==='near')c.position.z=g.room.brickWall.volume.frontZ+.42;
   for(let i=0;i<50;i++)window.diagnosticStep(1/60);g.renderer.render();await g.renderer.waitForFrame();
   const grip=g.fpsRig.anatomicalGrips().find(x=>x.side===1),q=grip.rotation.clone().invert(),hand=w.bone('hand.R'),long=w.point('middle.01.R').sub(w.point('hand.R')).normalize(),fore=w.point('hand.R').sub(w.point('forearm.R')).normalize();
   const tool=g.fpsRig.tools.get('fitting'),sourcePose={pitch,upperWorld:w.bone('upper_arm.R').getWorldQuaternion(q.clone()).toArray(),toolWorld:tool.getWorldQuaternion(q.clone()).toArray(),toolOffset:tool.getWorldPosition(c.position.clone()).sub(w.point('upper_arm.R')).toArray(),joints:['forearm.R','hand.R',...['thumb','index','middle','ring','little'].flatMap(d=>[1,2,3].map(i=>d+'.0'+i+'.R'))].map(name=>({name,quaternion:w.bone(name).quaternion.toArray()}))};
   return{name,pitch,yaw,sourcePose,wristBend:long.angleTo(fore)*180/Math.PI,handInGrip:q.clone().multiply(hand.getWorldQuaternion(q.clone())).toArray(),longInGrip:long.applyQuaternion(q).toArray(),wristInGrip:w.point('hand.R').sub(grip.center).applyQuaternion(q).toArray(),shoulder:w.point('upper_arm.R').toArray(),elbow:w.point('forearm.R').toArray(),wrist:w.point('hand.R').toArray(),telemetry:w.telemetry};
  },{name,pitch,yaw}));
  await p.screenshot({path:`${out}/${name}.png`});
  if(process.argv.includes('--views'))for(const side of [-1,1]){
   await p.evaluate(async side=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,v=g.modelInspector.camera,V=c.position.constructor;w.overview=true;w.update(0,c,g.player,g.fpsRig,'fitting',false,false);const target=c.position.clone().add(new V(0,-.38,0));v.position.copy(target).add(new V(side*1.2,.1,.3).applyAxisAngle(new V(0,1,0),g.player.yaw));v.lookAt(target);v.aspect=1440/900;v.fov=48;v.updateProjectionMatrix();g.renderer.viewCamera=v;g.renderer.render();await g.renderer.waitForFrame();},side);
   await p.screenshot({path:`${out}/${name}-body-${side}.png`});
  }
 }
 if(process.argv.includes('--motion')){
  await p.exposeFunction('motionShot',async name=>p.screenshot({path:`${out}/motion-${name}.png`}));
  report.motion=await p.evaluate(async()=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,Q=c.quaternion.constructor,V=c.position.constructor;
   g.renderer.viewCamera=null;w.overview=false;g.player.yaw=0;g.player.pitch=0;c.position.set(-.6,1.65,0);
   // Start from a settled scene after the previous near-wall fixture's
   // teleport; the following 240 frames contain uninterrupted real movement.
   for(let i=0;i<90;i++)window.diagnosticStep(1/60);
   const samples=[],cpu=[],frames=[];let last=performance.now(),previous;
   for(let i=0;i<240;i++){
    await new Promise(requestAnimationFrame);const start=performance.now();
    g.player.pitch=Math.sin(i/239*Math.PI*4)*1.18;g.player.yaw=Math.sin(i/239*Math.PI*2)*1.2;g.player.crouched=i>=80&&i<160;
    g.input.keys.clear();g.input.keys.add(['KeyW','KeyA','KeyS','KeyD'][Math.floor(i/60)]);
    window.diagnosticStep(1/60);
    const grip=g.fpsRig.anatomicalGrips().find(x=>x.side===1),inv=grip.rotation.clone().invert(),hand=w.bone('hand.R').getWorldQuaternion(new Q()),local=inv.clone().multiply(hand),wrist=w.point('hand.R'),fore=wrist.clone().sub(w.point('forearm.R')),long=w.point('middle.01.R').sub(wrist),upper=w.bone('upper_arm.R').getWorldQuaternion(new Q());
    const projected=grip.center.clone().project(c);
    samples.push({i,camera:c.position.toArray(),shoulder:w.point('upper_arm.R').toArray(),elbow:w.point('forearm.R').toArray(),front:g.workSurfaces.frontForBounds(g.fpsRig.heldToolBoundsWorld()),boundsZ:g.fpsRig.heldToolBoundsWorld().min.z,wristBend:long.angleTo(fore)*180/Math.PI,handInGrip:local.toArray(),wristInGrip:wrist.sub(grip.center).applyQuaternion(inv).toArray(),jointStep:previous?upper.angleTo(previous)*180/Math.PI:0,visible:Math.abs(projected.x)<1&&Math.abs(projected.y)<1,velocity:g.player.velocity.length()});previous=upper;
    if(i>20){cpu.push(performance.now()-start);frames.push(start-last);}last=start;g.renderer.render();await g.renderer.waitForFrame();
    if([0,60,83,100,123,140,160,180].includes(i))await window.motionShot(i);
   }
   g.input.keys.clear();const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];return{samples,cpuP95Ms:percentile(cpu,.95),frameP95Ms:percentile(frames,.95),frameMaxMs:Math.max(...frames),calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles};
  });
 }
 if(process.argv.includes('--verify')){
  assert.deepEqual(report.errors,[]);
  const reference=report.cases[0],distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i])),angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((sum,v,i)=>sum+v*b[i],0))))*180/Math.PI;
  for(const sample of [...report.cases,...report.motion?.samples??[]]){
   assert(sample.wristBend<15,`${sample.name??sample.i}: folded wrist`);
   assert(angle(reference.handInGrip,sample.handInGrip)<.1,`${sample.name??sample.i}: palm rolled around held rim`);
   assert(distance(reference.wristInGrip,sample.wristInGrip)<.001,`${sample.name??sample.i}: contact slipped`);
  }
  if(report.motion){assert(report.motion.samples.every(s=>s.visible),'held box left viewport');assert(Math.max(...report.motion.samples.map(s=>s.jointStep))<10,'arm snapped during aim');assert(report.motion.samples.filter(s=>s.velocity>.1).length>200,'movement was not exercised');}
  report.passed=true;
 }
 console.log(JSON.stringify(report.cases.map(({name,wristBend,longInGrip,handInGrip})=>({name,wristBend,longInGrip,handInGrip})),null,2));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
