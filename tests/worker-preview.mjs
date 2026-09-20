import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';
const output='output/worker-review';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});
 await page.locator('#start-button').click();await page.waitForTimeout(800);
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=()=>{};g.input.locked=false;});
 for(const [name,pitch,crouch]of [['down',-1.08,false],['forward',-.25,false],['crouch',-.75,true],['overview',-.25,false],['overview-crouch',-.25,true],['hand-close',-.25,false]]){
  const data=await page.evaluate(async({name,pitch,crouch})=>{
   const g=window.__wireTheHouse,c=g.renderer.camera,w=g.workerBody;
   g.player.pitch=pitch;g.player.yaw=0;g.player.crouched=crouch;c.position.set(-.5,crouch?.95:1.65,-1.3);c.rotation.set(pitch,0,0);c.updateMatrixWorld(true);
   const can=g.fpsRig.tools.get('spray');g.fpsRig.add(can);
   g.fpsRig.show('spray');g.fpsRig.visible=true;w.overview=name.startsWith('overview')||name==='hand-close';
   for(let i=0;i<80;i++)w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);
   w.traverse(o=>{
    if(!o.isSkinnedMesh)return;o.skeleton.update();o.computeBoundingBox();
    const box=o.boundingBox.clone().applyMatrix4(o.matrixWorld),extent=box.max.clone().sub(box.min);
    if(![extent.x,extent.y,extent.z].every(Number.isFinite)||Math.max(extent.x,extent.y,extent.z)>2.1)throw new Error(`Invalid deformed worker bounds: ${o.name} ${extent.toArray()}`);
   });
   const pose=w.poseSnapshot();
   const landmarks=Object.fromEntries(['thigh.R','thigh.L','shin.R','shin.L','foot.R','foot.L','toe.R','toe.L'].map(n=>[n,w.point(n).toArray()]));
   if(!crouch){
    if(landmarks['foot.R'][0]<=landmarks['foot.L'][0])throw new Error('Worker anatomical sides are reversed');
    for(const side of ['R','L'])if(landmarks['toe.'+side][2]>=landmarks['foot.'+side][2])throw new Error('Worker boot faces away from gameplay forward');
   }
   if(name.startsWith('overview')){
    g.renderer.scene.attach(can);
    w.position.z+=2;can.position.z+=2;w.updateMatrixWorld(true);
    c.position.set(.6,1.2,-1.1);c.lookAt(-.5,crouch?.48:.85,.8);
   }else if(name==='hand-close'){
    g.renderer.scene.attach(can);const hand=w.point('hand.R');c.position.copy(hand).add({x:.28,y:.09,z:-.28});c.lookAt(hand.clone().add({x:-.05,y:.02,z:-.01}));
   }
   g.renderer.render();await g.renderer.waitForFrame();
   const thumb=Object.fromEntries(['thumb.01.R','thumb.02.R','thumb.03.R'].map(n=>[n,w.point(n).toArray()]));
   return {telemetry:w.telemetry,pose,landmarks,thumb,render:g.renderer.webgl.info.render};
  },{name,pitch,crouch});
  await page.screenshot({path:`${output}/${name}.png`});await writeFile(`${output}/${name}.json`,JSON.stringify(data,null,2));
 }
 const clips=await page.evaluate(()=>{
  const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera,clips=[];g.fpsRig.add(g.fpsRig.tools.get('spray'));
  for(const name of ['Idle','Walk','Crouch','Spray']){
   w.phase=0;w.bend=0;g.player.yaw=0;g.player.pitch=-.25;g.player.crouched=false;
   c.position.set(0,1.65,0);c.rotation.set(-.25,0,0);g.player.velocity.set(0,0,0);
   const frames=[];const count=name==='Crouch'?120:61;
   for(let i=0;i<count;i++){
    const down=name==='Crouch'&&i>15&&i<90;g.player.crouched=down;c.position.y+=( (down?.95:1.65)-c.position.y)*.2;
    g.player.velocity.z=name==='Walk'?Math.PI*2/7:0;
    w.update(i===0?0:1/60,c,g.player,g.fpsRig,'spray',name==='Spray'&&i>20&&i<45,false);
    frames.push({time:i/60,bones:w.poseSnapshot()});
   }clips.push({name,frames});
  }return clips;
 });await writeFile(`${output}/clips.json`,JSON.stringify(clips));
 await writeFile(`${output}/errors.json`,JSON.stringify(errors));console.log({errors});
}finally{await browser.close();}
