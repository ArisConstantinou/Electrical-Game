import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/worker-hand-diagnostic';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:1200,height:900}});await blockPointerLock(ctx);const page=await ctx.newPage();
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await page.locator('#start-button').click();
 const result=await page.evaluate(async()=>{
  const T=await import('/Electrical-Game/node_modules/three/build/three.module.js');
  const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.step=()=>{};g.input.locked=false;w.overview=true;
  g.player.yaw=0;g.player.pitch=-.25;g.player.crouched=false;c.position.set(-.5,1.65,-1.3);c.rotation.set(-.25,0,0);
  w.__wrap=w.wrapGrip;w.wrapGrip=function(...args){this.__grip=args;};
  c.updateMatrixWorld(true);for(let i=0;i<80;i++)w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);
  const [side,center,rotation]=w.__grip,iq=rotation.clone().invert(),data={};
  for(const name of ['hand.R','forearm.R',...['index','middle','ring','little','thumb'].flatMap(d=>[1,2,3].map(n=>`${d}.0${n}.R`))]){
   const b=w.bone(name);data[name]={position:w.point(name).sub(center).applyQuaternion(iq).toArray(),axis:new T.Vector3(0,1,0).applyQuaternion(b.getWorldQuaternion(new T.Quaternion())).applyQuaternion(iq).toArray()};
  }
  g.renderer.scene.attach(g.fpsRig.tools.get('spray'));g.fpsRig.tools.get('spray').visible=false;w.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
  const aim=w.point('middle.01.R');c.position.copy(aim).add(new T.Vector3(.23,.10,-.25));c.lookAt(aim);c.fov=35;c.updateProjectionMatrix();
  g.renderer.render();await g.renderer.waitForFrame();return data;
 });await writeFile(`${out}/neutral.json`,JSON.stringify(result,null,2));await page.screenshot({path:`${out}/neutral.png`});
}finally{await browser.close();}
