import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const base=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/',out=process.argv[3]??'output/water-stream-visibility';await mkdir(out,{recursive:true});
const report={base,mobileIsEmulation:true,method:'Native held hose, then frozen scene screenshots with current, previous and hidden pressure column only. Screenshot contrast within projected stream bounds.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const backend of ['webgl','webgpu']){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});await blockPointerLock(context);
 const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+(backend==='webgl'?'?renderer=webgl':''));await page.locator('#start-button').tap({timeout:120000});await page.locator('[data-tool="hose"]').tap();await page.waitForTimeout(200);
 const cdp=await context.newCDPSession(page);
 for(const distance of [.65,1.2]){
  await page.evaluate(distance=>{const g=window.__wireTheHouse,c=g.renderer.camera;if(window.__streamStep)g.step=window.__streamStep;c.position.set(.7,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);c.lookAt(.7,1.3,g.room.brickWall.volume.frontZ);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;},distance);
  const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:4,x:b.x+b.width/2,y:b.y+b.height/2}]});await page.waitForTimeout(350);
  const bounds=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,w=g.roomWater;window.__streamStep=g.step.bind(g);g.step=()=>{};await g.renderer.waitForFrame();
   const mesh=w.jetCore,p=mesh.geometry.getAttribute('position'),ids=mesh.geometry.index.array,points=[];
   for(let i=0;i<mesh.geometry.drawRange.count;i++){const v=g.renderer.camera.position.clone().fromBufferAttribute(p,ids[i]).project(g.renderer.camera);points.push({x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2});}
   return{x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y)),active:mesh.visible,held:g.input.actionHeld};
  });assert(bounds.active&&bounds.held);
  const capture=async(name,mode)=>{await page.evaluate(async mode=>{const g=window.__wireTheHouse,m=g.roomWater.jetCore,geometry=m.geometry;
   if(!!geometry.userData.inward!==(mode==='previous')){const a=geometry.index.array;for(let i=0;i<a.length;i+=3){const t=a[i+1];a[i+1]=a[i+2];a[i+2]=t;}geometry.index.needsUpdate=true;geometry.computeVertexNormals();geometry.userData.inward=mode==='previous';}
   m.visible=mode!=='hidden';m.material.opacity=mode==='previous'?.14:.30;m.material.color.setHex(mode==='previous'?0xb6c9cc:0x8bbdce);m.material.roughness=mode==='previous'?.035:.055;
   g.renderer.render();await g.renderer.waitForFrame();},mode);return await page.screenshot({path:`${out}/${backend}-${distance}-${name}.png`});};
  const current=await capture('current','current'),previous=await capture('previous','previous'),hidden=await capture('hidden','hidden');
  const contrast=await page.evaluate(async({current,previous,hidden,bounds})=>{
   const decode=async encoded=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);return{width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};};
   const [a,b,c]=await Promise.all([decode(current),decode(previous),decode(hidden)]),scale=a.width/innerWidth;
   const stats=image=>{let total=0,changed=0,count=0,peak=0;for(let y=Math.max(0,Math.floor(bounds.y0*scale));y<Math.min(a.height,Math.ceil(bounds.y1*scale));y++)for(let x=Math.max(0,Math.floor(bounds.x0*scale));x<Math.min(a.width,Math.ceil(bounds.x1*scale));x++){const i=(y*a.width+x)*4,d=Math.max(...[0,1,2].map(k=>Math.abs(image.data[i+k]-c.data[i+k])));total+=d;peak=Math.max(peak,d);count++;if(d>=8)changed++;}return{total,changed,count,peak};};return{current:stats(a),previous:stats(b)};
  },{current:current.toString('base64'),previous:previous.toString('base64'),hidden:hidden.toString('base64'),bounds});
  await capture('current','current');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  report.cases.push({backend,distance,bounds,contrast});console.log(JSON.stringify(report.cases.at(-1)));
  assert(contrast.current.changed>=12&&contrast.current.peak>=20,'Stream must be visibly distinct from background at the nozzle');assert(contrast.current.total>contrast.previous.total*1.25,'Current column must be visibly clearer than the previous release');
 }await context.close();
}assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
