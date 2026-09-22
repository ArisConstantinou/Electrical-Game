import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out=process.argv[3]??'output/mobile-work-profile';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,method:'Real RAF, 390x844 touch Chromium with device scale 3. Public tool-selection event and native held USE; controlled sinusoidal camera rotation. Inclusive CPU timings overlap. Emulation, not physical iPhone FPS.',stages:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').tap({timeout:120000});
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,c=g.renderer.camera;
  c.position.set(.3,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.8);g.player.pitch=-.35;g.player.yaw=0;c.rotation.set(-.35,0,0,'YXZ');
  const p=window.__workProfile={active:false,rotate:false,methods:{},frames:[],presentations:[],draws:[],start:0};
  const wrap=(object,name,label)=>{const original=object[name];if(typeof original!=='function')return;object[name]=function(...args){
   if(label==='game.step'){if(p.rotate){g.player.yaw=Math.sin(performance.now()*.0016)*.3;}if(p.active)p.frames.push(performance.now());}
   const start=performance.now();try{return original.apply(this,args);}finally{if(p.active){const a=p.methods[label]??={calls:0,total:0,worst:0};const d=performance.now()-start;a.calls++;a.total+=d;a.worst=Math.max(a.worst,d);}}
  };};
  for(const [object,prefix,names] of [[g,'game',['step','performAction']],[g.player,'player',['update']],[g.fpsRig,'rig',['update','contact','poseArms','poseTrowel','aimWaterGun','constrainWorkSurfaces']],[g.workerBody,'body',['update']],[g.chasing,'debris',['update','spawnDebris','overlapsWall','hasWallSupport','supportContact']],[g.room.brickWall,'wall',['aim','removeAtAim','processPendingSupport','flushPendingMeshes']],[g.mortar,'mortar',['update','preview','coverage','swing','flushWetGeometry']],[g.roomWater,'water',['update']],[g.boxPlacement,'box',['update','target']],[g.boxFitPreview,'fit',['update']],[g.mixing,'mixing',['update','present']],[g.pvc,'pvc',['present','handleInput']],[g.apprentice,'apprentice',['update','presentPlayer']],[g.hud,'hud',['update','updateMobileUseStatus','updateMortar','updateWaterGun','updateWorkReticle']],[g.renderer,'render',['render']]])for(const name of names)wrap(object,name,prefix+'.'+name);
  if(location.search.includes('wallDiagnostic')){
   for(const [object,prefix,names] of [[g.room.brickWall,'wall',['strikeContact','flushGeometry','clearPaint','dispatchMeshes']],[g.room.brickWall.volume,'volume',['impact','detachIslands','exposeCavities','aggregateFragments','exportMeshJob','processPendingSupport']],[g.mortar,'mortar',['refreshOpeningGeometry','updateStages','syncFieldGeometry']],[g.mortar.field,'field',['tick','releaseUnsupported','remesh']]])for(const name of names)wrap(object,name,prefix+'.'+name);
  }
  if(location.search.includes('bodyDiagnostic')){
   for(const name of ['fitThumb','fitFinger','pinchBox','poseBoxGrasps','poseReferenceGrasps','wrapGrip','limb','posePipeGrip','boxViewportCorrection','boxObstacleCorrection','clampBoxComposition'])wrap(g.workerBody,name,'body.'+name);
   wrap(g.workSurfaces,'frontForBounds','clearance.frontForBounds');
   for(const name of ['boxGraspScreenObstacles','boxGraspViewCorners','clampFittingZones'])wrap(g.fpsRig,name,'rig.'+name);
   const finger=g.workerBody.fitFinger;
   g.workerBody.fitFinger=function(digit,side,target,...rest){
    if(p.active){const local=this.bone('hand.'+side).worldToLocal(target.clone()),key=digit+side,row=p.fingerTargets[key]??={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],calls:0};
     row.calls++;for(let i=0;i<3;i++){row.min[i]=Math.min(row.min[i],local.getComponent(i));row.max[i]=Math.max(row.max[i],local.getComponent(i));}}
    return finger.call(this,digit,side,target,...rest);
   };
  }
  const render=g.renderer.gpu.render.bind(g.renderer.gpu);
  g.renderer.gpu.render=(scene,camera)=>{const result=render(scene,camera);if(p.active&&scene===g.renderer.scene&&!g.renderer.gpu.getRenderTarget()){p.draws.push(g.renderer.webgl.info.render.calls);p.presentations.push(performance.now());}return result;};
 });
 const cdp=await context.newCDPSession(page);
 const only=process.argv.find(value=>value.startsWith('--only='))?.slice('--only='.length);
 const stages=(url.includes('bodyDiagnostic')?[['spray',false,true],['hose',true,true],['fitting',false,true],['level',false,true]]:[['spray',false,true],['hammer',true,true],['trowel',false,true],['hose',true,true],['fitting',false,true],['level',false,true],['spring',false,true],['cutter',false,true]]).filter(([tool])=>!only||tool===only);
 for(const [tool,held,rotate] of stages){
  await page.evaluate(tool=>window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:tool})),tool);
  await page.waitForFunction(tool=>window.__wireTheHouse.selectedTool===tool,tool);
  await page.evaluate(rotate=>{window.__workProfile.rotate=rotate;},rotate);
  if(tool==='hammer')await page.evaluate(async()=>{const wall=window.__wireTheHouse.room.brickWall;await wall.waitForGeometry();wall.peakGeometryLatencyMs=0;});
  if(held){const use=page.locator('#site-pro-use');const b=await (await use.count()?use:page.locator('#look-joystick')).boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:1}]});}
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{const p=window.__workProfile;p.methods={};p.fingerTargets={};p.frames=[];p.presentations=[];p.draws=[];p.start=performance.now();p.active=true;});
  await page.waitForTimeout(3200);
  const state=await page.evaluate(()=>{const p=window.__workProfile;p.active=false;const g=window.__wireTheHouse,duration=performance.now()-p.start,intervals=p.presentations.slice(1).map((t,i)=>t-p.presentations[i]).sort((a,b)=>a-b);return{selectedTool:g.selectedTool,fps:p.presentations.length*1000/duration,renderedFrames:p.presentations.length,p95Ms:intervals[Math.floor(intervals.length*.95)],frames:p.frames.length,drawCalls:p.draws.reduce((a,b)=>a+b,0)/p.draws.length,methods:Object.fromEntries(Object.entries(p.methods).map(([k,v])=>[k,{calls:v.calls,msPerFrame:v.total/p.frames.length,worst:v.worst}])),fingerTargets:p.fingerTargets,impacts:g.room.brickWall.impactCount,removedCm3:g.room.brickWall.volume.removedVolume*1e6,fragments:g.chasing.activeFragmentCount,wallGeometry:g.room.brickWall.telemetry,mortarFieldNodes:g.mortar.field.nodes.size,pixelRatio:g.renderer.webgl.getPixelRatio(),waterLitres:g.roomWater.telemetry.receivedLitres,renderer:g.renderer.performanceTelemetry??null,renderError:g.renderError??g.renderer.renderError,pointerLock:!!document.pointerLockElement};});
  report.stages.push({tool,held,rotate,...state});console.log(JSON.stringify(report.stages.at(-1)));
  if(held)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.screenshot({path:`${out}/${tool}.png`});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  assert.equal(state.pointerLock,false);assert.equal(state.renderError,'');assert(state.frames>10);
  if(tool==='hammer')assert(state.impacts>0&&state.removedCm3>0,'Held hammer must remove real wall material while rotating');
  if(tool==='hose')assert(state.waterLitres>0,'Held hose must emit real water');
 }
 assert.deepEqual(report.errors,[]);await context.close();
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
