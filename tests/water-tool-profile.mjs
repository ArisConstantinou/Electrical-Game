import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.argv[3]??'output/water-tool-profile';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,viewport:{width:1366,height:768},method:'Real RAF simulation and native held keyboard water. Inclusive JS method time instrumentation; nested measurements overlap. Not isolated GPU timing or physical-device performance.',stages:[],errors:[]};
try{
  const context=await browser.newContext({viewport:report.viewport});await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,{timeout:120000});await page.locator('#start-button').click();await page.keyboard.press('Digit8');
  await page.evaluate(()=>{
    const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.3,1.65,-1.35);c.lookAt(.3,1.2,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
    const qa=window.__waterProfile={active:false,methods:{},frames:[],start:0};
    const time=(label,fn,receiver,args)=>{const begin=performance.now();try{return fn.apply(receiver,args);}finally{if(qa.active){const item=qa.methods[label]??={calls:0,total:0,worst:0};const elapsed=performance.now()-begin;item.calls++;item.total+=elapsed;item.worst=Math.max(item.worst,elapsed);}}};
    const wrap=(object,name,label)=>{if(typeof object?.[name]!=='function')return;const original=object[name];object[name]=function(...args){if(label==='game.step'&&qa.active)qa.frames.push(performance.now());return time(label,original,this,args);};};
    wrap(g,'step','game.step');wrap(g.renderer,'render','renderer.renderSubmit');
    for(const method of ['update','rebuildGeometry','updateJetVisuals','updatePressureColumn'])wrap(g.roomWater,method,'water.'+method);
    for(const method of ['update','flow'])wrap(g.roomWater.field,method,'waterField.'+method);
    for(const method of ['update','preview','coverage','waterAtAim','waterGun','wetAtAim','moistureAt','raycast'])wrap(g.mortar,method,'mortar.'+method);
    for(const name of Object.getOwnPropertyNames(Object.getPrototypeOf(g.mortar)))if(/water|wet/i.test(name)&&!['waterAtAim','waterGun','wetAtAim'].includes(name))wrap(g.mortar,name,'mortar.'+name);
    for(const method of ['update','updateMortar','updateWaterGun','updateChiselOrientation'])wrap(g.hud,method,'hud.'+method);
    wrap(g.room.brickWall.volume,'raycast','masonry.raycast');wrap(g.room.brickWall,'aim','wall.aim');
    const getter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g.roomWater),'telemetry').get;
    Object.defineProperty(g.roomWater,'telemetry',{configurable:true,get(){return time('water.telemetry',getter,this,[]);}});
  });
  for(const stage of ['idle-dry-hose','held-water-wall','released-wet-hose']){
    if(stage==='held-water-wall')await page.keyboard.down('KeyE');
    if(stage==='released-wet-hose')await page.keyboard.up('KeyE');
    await page.waitForTimeout(1500);
    await page.evaluate(()=>{const p=window.__waterProfile;p.active=true;p.methods={};p.frames=[];p.start=performance.now();});
    await page.waitForTimeout(5000);
    const data=await page.evaluate(()=>{
      const p=window.__waterProfile;p.active=false;const duration=performance.now()-p.start,intervals=p.frames.slice(1).map((v,i)=>v-p.frames[i]).sort((a,b)=>a-b),g=window.__wireTheHouse;
      return{durationMs:duration,frames:p.frames.length,fps:p.frames.length*1000/duration,frameP95Ms:intervals[Math.floor(intervals.length*.95)],methods:Object.fromEntries(Object.entries(p.methods).map(([name,v])=>[name,{...v,meanCallMs:v.total/v.calls,msPerFrame:v.total/Math.max(1,p.frames.length)}])),water:g.roomWater.telemetry,renderError:g.renderer.renderError,pointerLock:document.pointerLockElement?.id??null,heap:performance.memory?.usedJSHeapSize};
    });
    report.stages.push({stage,...data});await page.screenshot({path:`${out}/${stage}.png`});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
    assert.equal(data.pointerLock,null);assert.equal(data.renderError,'');assert.equal(data.water.active,true);assert.ok(Math.abs(data.water.conservationErrorLitres)<1e-6);
    if(stage==='held-water-wall')assert.ok(data.water.receivedLitres>100,'native held FLOOD must deliver physical water throughout the sample');
    console.log(JSON.stringify({stage,fps:data.fps,p95:data.frameP95Ms,methods:Object.fromEntries(Object.entries(data.methods).map(([k,v])=>[k,{calls:v.calls,perFrame:v.msPerFrame,mean:v.meanCallMs}]))}));
  }
  assert.deepEqual(report.errors,[]);await context.close();
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
