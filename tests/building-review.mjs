import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const phase=process.argv[2]??'before';
const out=path.resolve('output/building-review',phase);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={phase,errors:[],poses:[],routes:[],environment:'Windows Chrome, 1366x768 DPR1; no physical mobile proof'};
try {
 const context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:1});
 await blockPointerLock(context);
 if(process.env.QA_DIST_ROOT){
  const root=path.resolve(process.env.QA_DIST_ROOT);
  await context.route('http://127.0.0.1:5365/Electrical-Game/**',async route=>{
   const file=path.resolve(root,decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length)||'index.html');
   if(!file.startsWith(root+path.sep))return route.abort();
   try{await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.wasm':'application/wasm'})[path.extname(file)]??'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Missing '+path.basename(file)});}
  });
 }
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');
 await page.locator('#start-button').click();
 await page.waitForFunction(()=>window.__wireTheHouse.started);
 for(const pose of [
  {name:'foyer',x:2.8,y:1.65,z:13.8,yaw:0.0,pitch:.15},
  {name:'ceiling',x:2.8,y:1.65,z:10,yaw:-1.1,pitch:.8},
  {name:'floor',x:2.8,y:1.65,z:10,yaw:-1.1,pitch:-.9},
  {name:'stairs',x:3.8,y:1.65,z:8.5,yaw:-1.5,pitch:.22},
  {name:'courtyard',x:12,y:1.65,z:14.4,yaw:1.8,pitch:.08},
  {name:'original',x:0,y:1.65,z:2.5,yaw:0,pitch:.13},
  {name:'exterior',x:-12,y:1.65,z:20,yaw:-1.0,pitch:.35},
  {name:'street',x:23,y:1.65,z:-14,yaw:2.54,pitch:.15},
  {name:'stair-overview',x:3.1,y:1.65,z:12.9,yaw:-1.05,pitch:.2},
  {name:'stair-landing',x:7.5,y:4.95,z:7.25,yaw:Math.PI,pitch:.1},
 ]){
  await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.camera.position.set(p.x,p.y,p.z);g.player.yaw=p.yaw;g.player.pitch=p.pitch;},pose);
  await page.waitForTimeout(450);
  await page.screenshot({path:path.join(out,pose.name+'.png'),timeout:15000});
  report.poses.push(await page.evaluate(name=>{const g=window.__wireTheHouse;return {name,position:g.player.camera.position.toArray(),calls:g.renderer.webgl?.info.render.calls,triangles:g.renderer.webgl?.info.render.triangles};},pose.name));
 }
 report.routes=process.argv.includes('--visual-only')?[]:await page.evaluate(()=>{
  const g=window.__wireTheHouse,p=g.player,wing=g.room.mansionWing;
  const originalStep=g.step;g.step=()=>{};
  p.wallWorkEnabled=false;const result=[];
  const walk=(name,x,z)=>{
   let frames=0,stalled=0;
   while(frames++<1500){const dx=x-p.camera.position.x,dz=z-p.camera.position.z;if(Math.hypot(dx,dz)<.04)break;
    const before=p.camera.position.clone();p.yaw=Math.atan2(-dx,-dz);g.input.mobileMove.y=-Math.min(1,Math.hypot(dx,dz)/.04);p.update(1/60);
    if(before.distanceTo(p.camera.position)<.0001)stalled++;else stalled=0;if(stalled>35)break;
   }
   g.input.mobileMove.y=0;for(let i=0;i<30;i++)p.update(1/60);
   const feet=p.camera.position.y-p.eyeHeight;
   const item={name,target:[x,z],position:p.camera.position.toArray(),feet,ok:Math.hypot(x-p.camera.position.x,z-p.camera.position.z)<.08,contacts:[...p.collisionContacts],nearby:wing.obstaclesAt(feet).filter(o=>o.minX<p.camera.position.x+.5&&o.maxX>p.camera.position.x-.5&&o.minZ<p.camera.position.z+.5&&o.maxZ>p.camera.position.z-.5).map(o=>({id:o.id,minX:o.minX,maxX:o.maxX,minZ:o.minZ,maxZ:o.maxZ}))};result.push(item);return item.ok;
  };
  p.camera.position.set(.55,p.eyeHeight,5.2);
  walk('original-room-entry',0,2);walk('return-from-original',0,9);
  walk('stair-approach',5.5,8.15);
  for(let level=1;level<=4;level++){
   if(!walk('L'+level+'-flight-A',5.5,11.64))break;
   if(!walk('L'+level+'-landing',7.5,11.64))break;
   if(!walk('L'+level+'-flight-B',7.5,7.2))break;
   if(!walk('L'+level+'-room',7.5,2.7))break;
   if(level<4){if(!walk('L'+level+'-return',7.5,7.25))break;if(!walk('L'+level+'-next-flight',5.5,7.25))break;if(!walk('L'+level+'-next-rise',5.5,8.15))break;}
  }
  for(let level=3;level>=-2;level--){
   if(!walk('descend-'+level+'-approach',7.5,7.25))break;
   if(!walk('descend-'+level+'-flight-B',7.5,11.64))break;
   if(!walk('descend-'+level+'-landing',5.5,11.64))break;
   if(!walk('descend-'+level+'-flight-A',5.5,7.25))break;
   if(!walk('descend-'+level+'-corridor',7.5,7.25))break;
   if(!walk('descend-'+level+'-room',7.5,2.7))break;
  }
  g.step=originalStep;return result;
 });
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
