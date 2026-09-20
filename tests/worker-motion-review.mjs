import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/worker-three-fixes/motion';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);const page=await context.newPage();
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await page.locator('#start-button').click();
 const rest=await page.evaluate(()=>{
  const g=window.__wireTheHouse,w=g.workerBody;g.step=()=>{};g.input.locked=false;g.fpsRig.visible=false;w.overview=true;
  w.position.set(0,0,0);w.rotation.set(0,0,0);for(const [b,r]of w.rest){b.quaternion.copy(r.q);b.position.copy(r.p);}w.updateMatrixWorld(true);
  return [...w.bones].map(([name,b])=>({name,matrix:b.matrixWorld.toArray()}));
 });
 const clips=[],directions=[['Forward',0,-1],['ForwardLeft',-1,-1],['Left',-1,0],['BackwardLeft',-1,1],['Backward',0,1],['BackwardRight',1,1],['Right',1,0],['ForwardRight',1,-1]];
 const modes=[['Walk',2.2,false],['Jog',3.41,false],['Crouch',2.2,true]];
 for(const [mode,speed,crouch]of modes)for(const [direction,rawX,rawZ]of directions){
  const magnitude=Math.hypot(rawX,rawZ),x=rawX/magnitude,z=rawZ/magnitude,name=mode+direction;
  const setup=await page.evaluate(async({name,x,z,speed,crouch})=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;
   g.player.yaw=0;g.player.pitch=0;g.player.crouched=crouch;g.player.velocity.set(x*speed,0,z*speed);g.fpsRig.visible=false;w.overview=true;w.phase=0;
   for(let i=0;i<120;i++){c.position.set(0,crouch?.95:1.65,0);w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);}
   const phase=w.phase; c.position.set(0,crouch?.95:1.65,0);w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);const rate=(w.phase-phase)*60;
   w.phase=0;
   window.__motionChunks=[];
   const stream=document.querySelector('canvas').captureStream(30);window.__motionRecorder=new MediaRecorder(stream,{mimeType:'video/webm'});window.__motionRecorder.ondataavailable=e=>window.__motionChunks.push(e.data);window.__motionRecorder.start();
   return {duration:Math.PI*2/rate};
  },{name,x,z,speed,crouch});
  const frames=[];
  for(let i=0;i<=60;i++){
   const frame=await page.evaluate(async({i,duration,crouch})=>{
    const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;
    c.position.set(0,crouch?.95:1.65,0);c.rotation.set(0,0,0);
    w.update(i===0?0:duration/60,c,g.player,g.fpsRig,'spray',false,false);
    w.updateMatrixWorld(true);w.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
    const bones=[...w.bones].map(([name,b])=>{const m=b.matrixWorld.clone();m.elements[12]-=w.position.x;m.elements[13]-=w.position.y;m.elements[14]-=w.position.z;return {name,matrix:m.toArray()};});
    c.position.set(1.45,1.2,-2.4);c.lookAt(0,crouch?.48:.83,.17);g.renderer.render();await g.renderer.waitForFrame();await new Promise(requestAnimationFrame);
    return {time:i*duration/60,bones};
   },{i,duration:setup.duration,crouch});frames.push(frame);
   if(i%15===0&&i<60)await page.screenshot({path:`${out}/${name}-${i}.png`});
  }
  const video=await page.evaluate(async()=>{const r=window.__motionRecorder;await new Promise(resolve=>{r.onstop=resolve;r.stop();});r.stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(window.__motionChunks,{type:'video/webm'}).arrayBuffer()));});
  await writeFile(`${out}/${name}.webm`,Buffer.from(video));clips.push({name,...setup,frames});
 }
 await writeFile(`${out}/source-poses.json`,JSON.stringify({rest,clips,directions:directions.map(([name,x,z])=>({name,x,z})),modes:modes.map(([name,speed,crouch])=>({name,speed,crouch}))}));console.log({clips:clips.length});
}finally{await browser.close();}
