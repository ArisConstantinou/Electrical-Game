import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/?renderer=webgl';
const out=process.argv[3]??'output/chisel-sustained';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,cpuSlowdown:Number(process.env.QA_CPU_RATE??4),method:'Native held tool under real RAF; touch Chromium 390x844 DPR3 with controlled camera sweep. CPU slowdown is comparative, not physical iPhone FPS.',stages:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.routeWebSocket('**',()=>{});
 await page.goto(url);await page.locator('#start-button').tap({timeout:120000});
 const cdp=await context.newCDPSession(page);
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,c=g.renderer.camera;
  c.position.set(.3,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.8);g.player.pitch=-.35;g.player.yaw=0;c.rotation.set(-.35,0,0,'YXZ');
  const p=window.__chiselProfile={active:false,rotate:false,start:0,methods:{},draws:[],steps:[]};
  const wrap=(object,name,label)=>{const fn=object[name];if(typeof fn!=='function')return;object[name]=function(...args){
   if(label==='game.step'&&p.rotate)g.player.yaw=Math.sin((performance.now()-p.start)*.001)*.28;
   const start=performance.now();try{return fn.apply(this,args);}finally{if(p.active)(p.methods[label]??=[]).push(performance.now()-start);}
  };};
  for(const [o,prefix,names]of [[g,'game',['step','performAction']],[g.room.brickWall,'wall',['removeAtAim','flushPendingMeshes','applyChunkMesh','processPendingSupport']],[g.room.brickWall.volume,'volume',['impact','extractFragments','exportChunk','meshChunk']],[g.chasing,'debris',['update','spawnDebris','overlapsWall','supportContact']],[g.fpsRig,'rig',['contact','update','poseArms']],[g.mortar,'mortar',['update','flushWetGeometry']]])for(const n of names)wrap(o,n,prefix+'.'+n);
  const render=g.renderer.gpu.render.bind(g.renderer.gpu);g.renderer.gpu.render=(s,c)=>{const v=render(s,c);if(p.active&&s===g.renderer.scene&&!g.renderer.gpu.getRenderTarget())p.draws.push(performance.now());return v;};
 });
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:report.cpuSlowdown});
 for(const [name,held]of [['camera-before',false],['sustained-chisel',true],['camera-after',false],['settled-camera',false]]){
  await page.locator('[data-tool="hammer"]').tap();
  await page.evaluate(()=>{const p=window.__chiselProfile;p.methods={};p.draws=[];p.start=performance.now();p.active=true;p.rotate=true;});
  if(held){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:b.x+b.width*.5,y:b.y+b.height*.5}]});}
  await page.waitForTimeout(held?12000:name==='settled-camera'?8000:2500);
  if(held)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const result=await page.evaluate(()=>{
   const p=window.__chiselProfile,g=window.__wireTheHouse;p.active=false;p.rotate=false;
   const stats=a=>{a=a.slice().sort((a,b)=>a-b);return{count:a.length,p50:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0,max:a.at(-1)??0,total:a.reduce((s,v)=>s+v,0)};};
   return{fps:p.draws.length*1000/(performance.now()-p.start),intervals:stats(p.draws.slice(1).map((v,i)=>v-p.draws[i])),methods:Object.fromEntries(Object.entries(p.methods).map(([k,v])=>[k,stats(v)])),impacts:g.room.brickWall.impactCount,removed:g.room.brickWall.volume.removedVolume,fragments:g.chasing.activeFragmentCount,canonicalTriangles:g.chasing.canonicalFragmentTriangles,renderedTriangles:g.chasing.renderedFragmentTriangles,pendingFragmentRendering:g.chasing.pendingFragmentRendering,held:g.input.actionHeld,lock:!!document.pointerLockElement,renderError:g.renderer.renderError};
  });
  assert(!result.held&&!result.lock);assert.equal(result.renderError,'');if(held)assert(result.impacts>5&&result.removed>0);
  report.stages.push({name,...result});console.log(JSON.stringify(report.stages.at(-1)));await page.screenshot({path:`${out}/${name}.png`});
 }
 assert.deepEqual(report.errors,[]);await context.close();
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
