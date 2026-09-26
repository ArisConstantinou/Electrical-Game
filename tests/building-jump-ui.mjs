import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const out=process.env.QA_LIVE==='1'?'output/building-jump-live':'output/building-jump';await mkdir(out,{recursive:true});const report={live:process.env.QA_LIVE==='1',profiles:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [name,width,height,mobile] of [['desktop',1366,768,false],['phone',390,844,true],['tablet',820,1180,true],['phone-landscape',844,390,true]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});await blockPointerLock(context);await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
  const r={name,cases:[]};report.profiles.push(r);
  if(mobile){
   r.controls=await page.evaluate(()=>['mobile-stand','mobile-crouch','mobile-jump','joystick','look-joystick','site-pro-use'].map(id=>{const e=document.getElementById(id),b=e.getBoundingClientRect();return {id,x:b.x,y:b.y,w:b.width,h:b.height,visible:getComputedStyle(e).display!=='none'};}));
   for(const control of r.controls){assert(control.visible);assert(control.w>=44&&control.h>=44);assert(control.x>=0&&control.y>=0&&control.x+control.w<=width+1&&control.y+control.h<=height+1);}
   const jump=r.controls.find(c=>c.id==='mobile-jump');for(const c of r.controls.filter(c=>c!==jump))assert(jump.x+jump.w<=c.x||c.x+c.w<=jump.x||jump.y+jump.h<=c.y||c.y+c.h<=jump.y,`Jump overlaps ${c.id}`);
  }
  const poses=name==='desktop'?[{name:'foyer',x:3.35,z:8.8,floor:0},{name:'doorway',x:3.35,z:7.25,floor:0},...[0,3.3,6.6,9.9,-3.4,-6.8].flatMap(base=>[{name:`flight-${base}`,x:5.5,z:9.54,floor:base+(base<0?3.4/22:.15)*6},{name:`landing-${base}`,x:6.5,z:11.64,floor:base+(base<0?1.7:1.65)}])]:[{name:'foyer',x:3.35,z:8.8,floor:0}];
  for(const p of poses){
   await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.camera.position.set(p.x,p.floor+1.65,p.z);g.player.yaw=-1.3;g.player.pitch=.2;g.selectedTool='spray';g.fpsRig.show('spray');},p);await page.waitForTimeout(200);
   await page.evaluate(()=>{const g=window.__wireTheHouse;window.__jumpFrames=[];window.__jumpStep=g.step;g.step=function(...args){const value=window.__jumpStep.apply(this,args);const p=g.player;window.__jumpFrames.push({offset:p.jumpOffset,grounded:p.grounded,head:p.camera.position.y+.22,floor:p.supportFloorY,bodyY:g.workerBody.position.y});return value;};});
   if(mobile)await page.locator('#mobile-jump').tap();else await page.keyboard.down('Space');
   await page.waitForFunction(()=>window.__jumpFrames.some(f=>f.offset>.2),null,{timeout:5000});
   if(p.name==='foyer')await page.screenshot({path:`${out}/${name}-airborne.png`});
   await page.waitForTimeout(900);if(!mobile)await page.keyboard.up('Space');
   const data=await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=window.__jumpStep;return {frames:window.__jumpFrames,ceiling:g.player.ceilingProvider(g.player.camera.position.x,g.player.camera.position.z,g.player.supportFloorY),state:JSON.parse(window.render_game_to_text()).player};});
   const peak=Math.max(...data.frames.map(f=>f.offset));assert(peak>.43&&peak<.53,`${name} ${p.name} jump clipped: ${peak}`);assert(data.frames.at(-1).grounded);assert(data.frames.every(f=>f.head<=data.ceiling+.001));
   let launches=0;for(let i=0;i<data.frames.length;i++)if(!data.frames[i].grounded&&(i===0||data.frames[i-1].grounded))launches++;assert.equal(launches,1,'Held Space must jump only once');
   assert(data.frames.some(f=>f.offset>.2&&Math.abs(f.bodyY-f.floor-f.offset)<.04),'Body must follow the jump');
   r.cases.push({name:p.name,peak,clearance:data.ceiling-p.floor,maxHead:Math.max(...data.frames.map(f=>f.head)),state:data.state});
  }
  await page.screenshot({path:`${out}/${name}-landed.png`});await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.profiles.map(r=>({name:r.name,cases:r.cases.length,minClearance:Math.min(...r.cases.map(c=>c.clearance))}))));
