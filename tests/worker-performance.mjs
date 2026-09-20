import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const motion=process.argv.includes('--motion');
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);const page=await context.newPage();
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await page.locator('#start-button').click();
 const result=await page.evaluate(async motion=>{
  const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.step=()=>{};g.input.locked=false;
  c.position.set(-.5,1.65,-1.3);c.rotation.set(-1.08,0,0);g.player.yaw=0;g.player.pitch=-1.08;g.player.crouched=false;g.player.velocity.set(0,0,0);g.fpsRig.show('spray');
  const runs=[];const percentile=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)];
  for(const enabled of motion?[true]:[false,true,false,true]){
   w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);w.visible=enabled;g.fpsRig.useAnatomicalSpray(enabled);
   const cpu=[],frames=[],pose=[];let last=performance.now();
   for(let i=0;i<100;i++){
    await new Promise(requestAnimationFrame);const start=performance.now();
    if(motion){g.player.crouched=i>=35&&i<70;g.player.velocity.set(i<75?2.2:0,0,0);g.player.yaw=Math.sin(i*.07)*.4;c.position.y=g.player.crouched?.95:1.65;c.rotation.set(-1.08,g.player.yaw,0);}
    if(enabled){w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);}
    const posed=performance.now();g.renderer.render();await g.renderer.waitForFrame();
    if(i>=20){cpu.push(performance.now()-start);pose.push(posed-start);frames.push(start-last);}last=start;
   }
   runs.push({enabled,cpuSubmitMedianMs:percentile(cpu,.5),cpuSubmitP95Ms:percentile(cpu,.95),poseP95Ms:percentile(pose,.95),frameMedianMs:percentile(frames,.5),frameP95Ms:percentile(frames,.95),frameMaxMs:Math.max(...frames),framesOver50ms:frames.filter(n=>n>50).length,render:{...g.renderer.webgl.info.render}});
  }
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
  return {device:{browser:navigator.userAgent,cores:navigator.hardwareConcurrency,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable'},viewport:[1440,810],scope:motion?'Headless desktop WebGL: changing yaw, lateral movement, crouch transitions and stop; CPU submission is not GPU timing; mobile not measured':'Frozen scene; headless desktop WebGL, old visible rig vs new worker; CPU submission is not GPU timing; mobile not measured',runs};
 },motion);await writeFile(motion?'output/worker-three-fixes/motion-performance.json':'output/worker-review/performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
