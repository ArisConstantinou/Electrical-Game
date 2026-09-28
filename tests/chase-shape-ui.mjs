import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const url=process.env.CHASE_SHAPE_URL??'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out=process.env.CHASE_SHAPE_OUT??'output/hammer-facing/chase-shape';
const baseline=process.env.CHASE_SHAPE_BASELINE==='1';
await mkdir(out,{recursive:true});
const report={url,baseline,mobileIsEmulation:true,fixture:'Pristine real wall with fixed test seed and repeated finite physical 4 J / 50 mm blade contacts along a vertical path and horizontal branch. Contacts use the production raycast, strikeContact, chase depth, fragments, support, workers and renderer. No fabricated cuts, poses, altered fracture results or decorative overlays. Native input/arm regressions are separate.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const mobile of [false,true]){
  if(process.env.CHASE_SHAPE_DESKTOP_ONLY==='1'&&mobile)continue;
  const name=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},hasTouch:mobile,isMobile:mobile});
  await blockPointerLock(context);await serveTaskBuild(context,url);
  await context.addInitScript(()=>{const random=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=array=>{random(array);if(array instanceof Uint32Array&&array.length===1)array[0]=193187;return array;};});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
  await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
  await page.evaluate(()=>{const g=window.__wireTheHouse,v=g.room.brickWall.volume,saved=v.serialize();saved.chunks=[];saved.pendingSupport=[];saved.removedVolume=0;saved.sequence=0;v.restore(saved);g.room.brickWall.flushGeometry();window.__shapeStep=g.step.bind(g);g.step=()=>{};g.fpsRig.visible=false;g.selectedTool='measure';for(const p of g.mission.points)p.boxGroup.visible=false;});
  const shape=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume,V=g.renderer.camera.position.constructor;
   const depth=w.chaseDepthM??.105,dir=new V(.15,-.20,-1).normalize(),edge=new V(1,0,dir.x).normalize();
   const points=[];for(let y=.50;y<=1.82;y+=.024)points.push([-.80,y]);for(let x=-.80;x<=.52;x+=.024)points.push([x,1.13]);
   const timings=[],pieces=[];let accepted=0;
   for(let pass=0;pass<5;pass++)for(const [x,y] of pass%2?[...points].reverse():points){
    const origin=new V(x,y,v.frontZ+.025),hit=v.raycast(origin,dir,.32);if(!hit)continue;
    const contact={point:new V(hit.point.x,hit.point.y,hit.point.z),direction:dir,edge,chisel:'flat',energyJ:4,widthM:.05};
    const t=performance.now(),impact=w.strikeContact(contact,depth);timings.push(performance.now()-t);
    if(impact){accepted++;pieces.push(...impact.fragments.map(f=>({material:f.material,volume:f.volume,size:f.size})));g.chasing.spawnDebris(impact);}
    window.__shapeStep(1/60);if(accepted%12===0){await g.chasing.waitForDebrisSplits();await g.renderer.waitForFrame();}
   }
   for(let i=0;i<180;i++)window.__shapeStep(1/60);await w.waitForGeometry();await g.renderer.waitForFrame();
   let maxRemovedDepth=0,rearRemoved=0,clayRemoved=0,mortarRemoved=0;
   for(let iy=1;iy<=v.ny;iy++)for(let ix=1;ix<=v.nx;ix++){
    const p=v.nodePosition(ix,iy,1);if(p.x<-.99||p.x>.70||p.y<.32||p.y>2.02)continue;
    for(let iz=1;iz<=v.nz;iz++){const original=v.baseMaterial(ix,iy,iz);if(!original||v.nodeMaterial(ix,iy,iz))continue;const d=v.frontZ-v.nodePosition(ix,iy,iz).z;maxRemovedDepth=Math.max(maxRemovedDepth,d);if(d>.125)rearRemoved++;if(original===1)clayRemoved++;if(original===2)mortarRemoved++;}
   }
   const widths=[];for(let y=.56;y<1.78;y+=.024){if(Math.abs(y-1.13)<.15)continue;let min=Infinity,max=-Infinity;for(let x=-1.02;x<-.55;x+=v.hx){const hit=v.raycast({x,y,z:v.frontZ+.025},{x:0,y:0,z:-1},.32);if(hit&&v.frontZ-hit.point.z>.014){min=Math.min(min,x);max=Math.max(max,x);}}if(max>min)widths.push(max-min);}
   timings.sort((a,b)=>a-b);
   return{seed:v.seed,depth,accepted,clayRemoved,mortarRemoved,rearRemoved,maxRemovedDepth,widths,widthRange:widths.length?Math.max(...widths)-Math.min(...widths):0,removedVolume:v.removedVolume,fragmentVolume:pieces.reduce((n,p)=>n+p.volume,0),fragments:pieces.length,materialKinds:[...new Set(pieces.map(p=>p.material))],timings:{p95:timings[Math.floor(timings.length*.95)],max:timings.at(-1)},telemetry:w.telemetry,renderError:g.renderer.renderError};
  });
  async function shot(kind){await page.evaluate(({mobile,kind})=>{const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor;if(kind==='close'||kind==='front'){c.position.set(kind==='front'?-.80:mobile?-1.04:-1.14,1.16,g.room.brickWall.volume.frontZ+(mobile?.43:.50));c.lookAt(new V(-.8,1.16,g.room.brickWall.volume.frontZ-.03));}else{c.position.set(mobile?-.09:.20,1.30,g.room.brickWall.volume.frontZ+(mobile?1.82:2.10));c.lookAt(new V(-.28,1.15,g.room.brickWall.volume.frontZ-.03));}g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);g.fpsRig.visible=false;g.room.invalidateSunShadow();g.renderer.render();},{mobile,kind});await page.evaluate(()=>window.__wireTheHouse.renderer.waitForFrame());await page.screenshot({path:`${out}/${name}-${kind}.png`});return page.evaluate(()=>{const g=window.__wireTheHouse;return{calls:g.renderer.webgl.info.render.calls||null,memory:g.renderer.webgl.info.memory,triangles:g.room.brickWall.telemetry.surfaceTriangles,overflow:document.documentElement.scrollWidth>innerWidth};});}
  const wide=await shot('wide'),close=await shot('close'),front=await shot('front');report.cases.push({name,shape,wide,close,front});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({name,...shape,telemetry:undefined,widths:undefined,wide:{...wide,memory:undefined},close:{...close,memory:undefined},front:{...front,memory:undefined}}));
  if(!baseline){assert(shape.accepted>50);assert(shape.clayRemoved>300&&shape.mortarRemoved>20,'Path must cross actual clay and mortar');assert.equal(shape.rearRemoved,0,'Service chase broke the rear leaf');assert(shape.maxRemovedDepth<=.085,'Service path exceeded its first-bay depth');assert(shape.widths.length>25&&shape.widthRange>.012,'Path edges remain uniform');assert(Math.abs(shape.fragmentVolume-shape.removedVolume)<1e-8,'Cut material and physical fragments diverged');assert(!wide.overflow&&!close.overflow);assert.equal(shape.renderError,'');}
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=!baseline;
}catch(error){report.failure=String(error.stack??error);throw error;}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
