import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';

const out=process.env.QA_BODY_OUT??'output/body-clearance/verified';
await mkdir(out,{recursive:true});
const baseline=process.env.QA_BODY_BASELINE==='1';
const server=await chromium.launchServer({channel:'chrome',headless:true});
const browser=await chromium.connect(server.wsEndpoint());
const report={baseline,browserPid:server.process().pid,backend:process.env.QA_BODY_BACKEND??'webgl',cases:[],transitions:[],performance:[],errors:[],processes:[]};
console.log('Owned test browser PID',report.browserPid);
function ownedProcesses(){
 if(process.platform!=='win32')return [];
 return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$owned=@(${report.browserPid}); $all=Get-CimInstance Win32_Process; do { $extra=@($all | Where-Object { $_.ParentProcessId -in $owned -and $_.ProcessId -notin $owned } | ForEach-Object ProcessId); $owned+=$extra } while($extra.Count); ConvertTo-Json -InputObject @($all | Where-Object ProcessId -in $owned | Select-Object ProcessId,CreationDate,CommandLine)`],{encoding:'utf8'})||'[]');
}
try{
 for(const viewport of [{width:1600,height:900},{width:390,height:844}]){
  const mobile=viewport.width<500;
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:5365/Electrical-Game/?renderer=${report.backend}`);
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
  await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();await page.keyboard.press('Digit4');
  await page.addStyleTag({content:'#fps-counter{visibility:hidden!important}'});
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.qaBodyStep=g.step.bind(g);g.step=()=>{};});
  report.processes=ownedProcesses();
  for(const pose of [...[-1.15,-.55,0,.55,1.15].map(pitch=>({name:String(pitch),pitch})),{name:'crouch-down',pitch:-1.15,crouch:true},{name:'free-down',pitch:-1.15,free:true},{name:'side-left',pitch:-.55,yaw:-.6},{name:'side-right',pitch:-.55,yaw:.6}]){
   const state=await page.evaluate(async({pose,baseline})=>{
    const g=window.__wireTheHouse,camera=g.player.camera,body=g.workerBody;
    g.input.actionHeld=false;g.player.crouched=!!pose.crouch;g.player.velocity.set(0,0,0);
    camera.position.set(0,pose.crouch?.95:1.65,pose.free?1:g.room.brickWall.volume.frontZ+1.08);g.player.yaw=pose.yaw??0;g.player.pitch=pose.pitch;
    g.player.workPosition.locked=!pose.free;g.player.workPosition.released=!!pose.free;g.player.workPosition.targetDistanceM=1.08;
    for(let i=0;i<90;i++)window.qaBodyStep(1/60,1/60,false);
    await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();
    const errors=[];
    if(!baseline)for(const side of ['L','R'])for(const name of ['forearm.','hand.','thumb.03.','index.03.','little.03.']){
     const world=body.bone(name+side),view=body.firstPersonArms.bone(name+side);
     errors.push({name:name+side,distance:world.getWorldPosition(camera.position.clone()).distanceTo(view.getWorldPosition(camera.position.clone())),rotation:world.getWorldQuaternion(camera.quaternion.clone()).normalize().angleTo(view.getWorldQuaternion(camera.quaternion.clone()).normalize())});
    }
    // The old shirt/neck entering the reticle is a geometric obstruction,
    // independently of the hand-contact assertions above.
    const ray=g.mortar.ray,obstructions=[];
    body.traverse(mesh=>{if(mesh.isSkinnedMesh){mesh.computeBoundingBox();mesh.computeBoundingSphere();}});
    for(const x of [-.25,0,.25])for(const y of [-.25,0,.25]){
     ray.setFromCamera({x,y},camera);
     const hits=ray.intersectObject(body,true).filter(hit=>{
      for(let p=hit.object;p;p=p.parent)if(!p.visible)return false;
      const material=Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material;
      if(!material.colorWrite||!/cotton|collar/i.test(material.name))return false;
      const color=hit.object.geometry.getAttribute('color');
      if(color&&color.itemSize===4&&hit.barycoord){const f=hit.face,b=hit.barycoord;if(color.getW(f.a)*b.x+color.getW(f.b)*b.y+color.getW(f.c)*b.z<material.alphaTest)return false;}
      return true;
     });
     if(hits.length)obstructions.push({x,y,distance:hits[0].distance});
    }
    let gloveSurfaceDelta=0;
    if(!baseline){
     const original=[],copies=[];
     body.children[0].traverse(mesh=>{if(mesh.isSkinnedMesh&&/glove/i.test(mesh.material.name))original.push(mesh);});
     body.firstPersonArms.traverse(mesh=>{if(mesh.isSkinnedMesh&&/glove/i.test(mesh.material.name))copies.push(mesh);});
     for(const mesh of original){const copy=copies.find(m=>m.name===mesh.name);if(!copy)throw new Error('Missing first-person glove');
      const a=camera.position.clone(),b=a.clone();for(let i=0;i<mesh.geometry.attributes.position.count;i+=29){mesh.getVertexPosition(i,a);copy.getVertexPosition(i,b);gloveSurfaceDelta=Math.max(gloveSurfaceDelta,a.applyMatrix4(mesh.matrixWorld).distanceTo(b.applyMatrix4(copy.matrixWorld)));}
     }
    }
    return {name:pose.name,pitch:pose.pitch,grips:body.telemetry.gripReachErrors,errors,gloveSurfaceDelta,obstructions,renderer:g.renderer.renderError,position:camera.position.toArray(),rotation:camera.quaternion.toArray()};
   },{pose,baseline});
   report.cases.push({viewport,...state});
   await page.screenshot({path:`${out}/${viewport.width}-${pose.name}.png`});
   assert.equal(state.renderer,'');
   if(!baseline)for(const error of state.errors){assert(error.distance<1e-6,`${error.name}: contact moved`);assert(error.rotation<1e-6,`${error.name}: contact rotated`);}
   if(!baseline)assert.equal(state.obstructions.length,0,`${pose.name}: shirt in aiming region`);
   if(!baseline)assert(state.gloveSurfaceDelta<.001,`${pose.name}: glove surface left its grip`);
  }
  const transition=await page.evaluate(async baseline=>{
   const g=window.__wireTheHouse,body=g.workerBody;
   g.frontBodyView=true;window.qaBodyStep(1/60,1/60,false);
   await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();
   const overview=baseline||!body.firstPersonArms.visible&&body.bodyMaterials.every(m=>m.colorWrite&&m.depthWrite);
   const shadowMeshes=[];body.children[0].traverse(o=>{if(o.isMesh)shadowMeshes.push(o.castShadow);});
   return {overview,shadow:shadowMeshes.length>0&&shadowMeshes.every(Boolean)};
  },baseline);
  await page.screenshot({path:`${out}/${viewport.width}-overview.png`});
  assert(transition.overview,'External body view missing');assert(transition.shadow,'Incomplete worker shadow');
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.frontBodyView=false;window.qaBodyStep(1/60,1/60,false);});
  await page.keyboard.press('Digit3');
  transition.otherTool=await page.evaluate(baseline=>{const g=window.__wireTheHouse;for(let i=0;i<30;i++)window.qaBodyStep(1/60,1/60,false);return baseline||!g.workerBody.firstPersonArms.visible&&g.workerBody.bodyMaterials.every(m=>m.colorWrite&&m.depthWrite);},baseline);
  assert(transition.otherTool,'Body view did not restore after changing tool');report.transitions.push({viewport,...transition});
  await page.keyboard.press('Digit4');
  report.performance.push({viewport,...await page.evaluate(async()=>{
   const g=window.__wireTheHouse,frame=[],bodyTimes=[],body=g.workerBody,original=body.update.bind(body);
   g.player.crouched=false;g.player.yaw=0;g.player.pitch=-.55;g.player.camera.position.set(0,1.65,g.room.brickWall.volume.frontZ+1.08);
   g.player.workPosition.locked=true;g.player.workPosition.released=false;
   for(let i=0;i<60;i++)window.qaBodyStep(1/60,1/60,false);
   body.update=(...args)=>{const start=performance.now();original(...args);bodyTimes.push(performance.now()-start);};
   g.step=window.qaBodyStep;
   await new Promise(resolve=>{let last=0,count=0;const sample=t=>{if(last&&count>30)frame.push(t-last);last=t;if(++count<151)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});
   g.step=()=>{};body.update=original;
   const stats=values=>{const sorted=values.toSorted((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...values),count:values.length};};
   return {framesMs:stats(frame),bodyUpdateMs:stats(bodyTimes),drawCalls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,memory:g.renderer.webgl.info.memory,heapBytes:performance.memory?.usedJSHeapSize,backend:g.renderer.webgl.backend.isWebGPUBackend?'WebGPU':'WebGL',userAgent:navigator.userAgent};
  })});
  await context.close();
 }
 if(baseline)assert(report.cases.some(c=>c.obstructions.length),'Baseline failed to reproduce the obstruction');
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{
 await browser.close();await server.close();report.browserExitCode=server.process().exitCode;
 if(process.platform==='win32'&&report.processes.length){
  const ids=report.processes.map(p=>p.ProcessId).join(',');
  report.remainingOwnedPids=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`ConvertTo-Json -InputObject @(Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object Id)`],{encoding:'utf8'})||'[]');
 }
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,browserExitCode:report.browserExitCode}));
