import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import ts from 'typescript';
import {blockPointerLock} from './browser-safety.mjs';
const phase=process.argv[2]??'before',out=`output/wrist-pitch/${phase}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});await blockPointerLock(context);
 const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 if(process.argv.includes('--fixed'))await p.route('**/src/player/WorkerBody.ts*',async route=>{
  const response=await route.fetch(),live=await response.text();
  let source=await readFile('src/player/WorkerBody.ts','utf8');
  source=source.replace("let long=grip.center.clone().sub(this.point('upper_arm.'+side));","let long=oldBack.clone().negate();").replace("if(pass===0)long=this.point('hand.'+side).sub(this.point('forearm.'+side)).normalize();",'');
  source=source.replace("wrist,right.clone().multiplyScalar(sign*.45).add(new THREE.Vector3(0,-1,0))","wrist,long.clone().negate()");
  let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/Electrical-Game/'));
  code=code.replace(/from ["']([^"']+)["']/g,(match,spec)=>spec==='three'?`from ${JSON.stringify(live.match(/import \* as THREE from ["']([^"']+)/)[1])}`:spec==='three/addons/loaders/GLTFLoader.js'?`from ${JSON.stringify(live.match(/import \{ GLTFLoader \} from ["']([^"']+)/)[1])}`:match);
  await route.fulfill({response,body:code,contentType:'application/javascript'});
 });
 await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();
 await p.evaluate(experiment=>{const g=window.__wireTheHouse;window.reviewStep=g.step.bind(g);g.step=()=>{};g.input.locked=false;
  if(experiment){const w=g.workerBody,original=w.setHandOrientation;w.setHandOrientation=function(side,axis,long){if(window.reviewTool!=='spray')this.limb('upper_arm.'+side,'forearm.'+side,'hand.'+side,this.point('hand.'+side),long.clone().negate());return original.call(this,side,axis,long);};}
 },process.argv.includes('--pole'));
 const tools=process.env.REVIEW_TOOLS?.split(',')??['spray','hammer','fitting','level','spring','cutter','trowel','hose','measure','drill','driver','laser','mix:water','mix:trowel','mix:shovel','mix:mixer'];
 const views=process.argv.includes('--yaw')?[[-.25,-.8],[-.25,.8],[-1.15,-.8],[-1.15,.8]]:[[0,0],[-.6,0],[-1.15,0],[1.15,0]];
 for(const tool of tools)for(const [pitch,yaw] of views){
  const data=await p.evaluate(async({tool,pitch,yaw})=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,station=tool.startsWith('mix:');window.reviewTool=tool;
   g.mixing.setActive(station);if(station)g.mixing.chooseTool(tool.slice(4));else g.selectTool(tool);
   g.player.workPosition.locked=false;g.player.workPosition.released=true;g.player.crouched=false;g.player.velocity.set(0,0,0);g.player.yaw=yaw;g.player.pitch=pitch;c.position.set(-.6,1.65,g.room.brickWall.volume.frontZ+1.1);w.overview=false;g.renderer.viewCamera=null;
   for(let i=0;i<40;i++)window.reviewStep(1/60);g.renderer.render();await g.renderer.waitForFrame();
   const grips=(station?g.mixing.anatomicalGrips():g.fpsRig.anatomicalGrips()).filter(x=>x.active),arms={};
   for(const grip of grips){const side=grip.side>0?'R':'L',wrist=w.point('hand.'+side),elbow=w.point('forearm.'+side),shoulder=w.point('upper_arm.'+side),long=w.point('middle.01.'+side).sub(wrist),projected=wrist.clone().project(c);arms[side]={bend:long.angleTo(wrist.clone().sub(elbow))*180/Math.PI,elbowAngle:shoulder.clone().sub(elbow).angleTo(wrist.clone().sub(elbow))*180/Math.PI,wrist:wrist.toArray(),elbow:elbow.toArray(),shoulder:shoulder.toArray(),handInGrip:grip.rotation.clone().invert().multiply(w.bone('hand.'+side).getWorldQuaternion(c.quaternion.clone())).toArray(),projected:projected.toArray(),visible:Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&projected.z>-1&&projected.z<1};}
   return{tool,pitch,yaw,arms,solve:w.userData.graspSolve,telemetry:w.telemetry};
  },{tool,pitch,yaw});report.cases.push(data);
  if(process.env.REVIEW_ALL_SHOTS||pitch===-1.15||tool==='drill')await p.screenshot({path:`${out}/${tool.replace(':','-')}-${pitch}${yaw?'-yaw'+yaw:''}.png`});
 }
 const trowelCases=report.cases.filter(c=>c.tool==='trowel'||c.tool==='hose');
 for(const c of trowelCases){
  const bend=c.arms.R?.bend??Infinity,elbow=c.arms.R?.elbowAngle??0;
  assert(bend<(Math.abs(c.pitch)<=.6?15:35),`${c.tool} wrist bends ${bend.toFixed(1)}° at pitch ${c.pitch}`);
  if(c.pitch<=0)assert(elbow>=158,`${c.tool} elbow folds to ${elbow.toFixed(1)}° at pitch ${c.pitch}`);
  if(c.pitch<=0)assert(c.arms.R?.visible,`${c.tool} wrist leaves the camera at pitch ${c.pitch}`);
 }
 console.log(JSON.stringify(report.cases.map(c=>({tool:c.tool,pitch:c.pitch,wrists:Object.fromEntries(Object.entries(c.arms).map(([k,v])=>[k,Math.round(v.bend)]))})),null,2));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
