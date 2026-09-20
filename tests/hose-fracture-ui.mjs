import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const base=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/',out=process.argv[3]??'output/hose-fracture-ui';
await mkdir(out,{recursive:true});
const report={base,mobileIsEmulation:true,fixture:'Actual chisel impacts create the recess. Native held USE wets it under real RAF; screenshots sample the same fixed camera. No material, contact or rendering methods are stubbed.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const spec of [{name:'desktop',width:1366,height:768,mobile:false,webgl:false},{name:'portrait',width:390,height:844,mobile:true,webgl:true},{name:'landscape',width:844,height:390,mobile:true,webgl:false}]){
  if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==spec.name)continue;
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},isMobile:spec.mobile,hasTouch:spec.mobile});await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(base+(spec.webgl?'?renderer=webgl':''));await page.locator('#start-button')[spec.mobile?'tap':'click']({timeout:120000});
  await page.evaluate(async()=>{
   const g=window.__wireTheHouse,v=g.room.brickWall.volume;
   for(let i=0;i<70;i++){
    const x=.64+i%7*.022,y=1.40+Math.floor(i/7)*.016,hit=v.raycast({x,y,z:-2},{x:0,y:0,z:-1},.8);
    if(hit)v.impact({point:hit.point,direction:{x:0,y:0,z:-1},edge:{x:1,y:0,z:0},chisel:'flat',widthM:.05,energyJ:8});
   }
   g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
   const c=g.renderer.camera;c.position.set(.7,g.player.eyeHeight,v.frontZ+.65);c.lookAt(.7,1.47,v.frontZ-.025);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;
   window.__hosePerformance={steps:[],patches:[]};
   for(const [object,name,bucket]of [[g,'step','steps'],[g.mortar,'addWetPatch','patches']]){
    const original=object[name];object[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{if(g.selectedTool==='hose'&&g.input.actionHeld)window.__hosePerformance[bucket].push(performance.now()-start);}};
   }
  });
  if(spec.mobile)await page.locator('[data-tool="hose"]').tap();else await page.keyboard.press('Digit8');
  await page.waitForTimeout(750);
  const snapshot=()=>page.evaluate(()=>{
   const g=window.__wireTheHouse,m=g.mortar;
   return{pitch:g.player.pitch,yaw:g.player.yaw,held:g.input.actionHeld,removed:g.room.brickWall.volume.removedNodeCount,impacts:g.room.brickWall.volume.impactCount,chunks:[...g.room.brickWall.chunks].map(([key,mesh])=>[key,mesh.geometry.uuid]),wetCells:m.water.size,wetTriangles:[...m.water.values()].reduce((sum,c)=>sum+c.patch.count/3,0),emptyWetCells:[...m.water.values()].filter(c=>c.patch.count===0).length,wetBatches:m.wetBatches.length,litres:m.waterGunLitres,backend:g.roomWater.telemetry.backend,renderError:g.renderer.renderError,locked:!!document.pointerLockElement,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const before=await snapshot();assert(before.removed>0&&before.chunks.length>0);
  const cdp=spec.mobile?await context.newCDPSession(page):null;
  if(cdp){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:b.x+b.width*.5,y:b.y+b.height*.65}]});}else await page.keyboard.down('KeyE');
  const frames=[];
  for(let frame=0;frame<3;frame++){await page.waitForTimeout(550);await page.evaluate(()=>window.__wireTheHouse.renderer.waitForFrame());frames.push(await snapshot());await page.screenshot({path:`${out}/${spec.name}-wet-${frame}.png`});}
  if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.keyboard.up('KeyE');
  await page.waitForTimeout(350);const after=await snapshot();
  assert(after.wetCells>0&&after.wetTriangles>0,'Real hose contact produces visible wet masonry');assert(after.litres>0);
  for(const sample of [...frames,after]){assert.equal(sample.pitch,before.pitch,'Holding/releasing hose must not steer camera');assert.equal(sample.yaw,before.yaw);assert.equal(sample.removed,before.removed);assert.equal(sample.impacts,before.impacts);assert.deepEqual(sample.chunks,before.chunks,'Water must not replace the underlying wall mesh');assert.equal(sample.renderError,'');assert(!sample.locked&&!sample.overflow);}
  const timings=await page.evaluate(()=>Object.fromEntries(Object.entries(window.__hosePerformance).map(([key,values])=>{const sorted=values.slice().sort((a,b)=>a-b);return[key,{count:values.length,p50:sorted[Math.floor(sorted.length*.5)]??0,p95:sorted[Math.floor(sorted.length*.95)]??0,max:sorted.at(-1)??0}];})));
  assert(!after.held);assert.equal(after.backend,spec.webgl?'webgl':'webgpu');report.cases.push({spec,before,frames,after,timings});console.log(JSON.stringify({name:spec.name,passed:true,wetCells:after.wetCells,triangles:after.wetTriangles,batches:after.wetBatches,timings}));await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:true,cases:report.cases.length}));
