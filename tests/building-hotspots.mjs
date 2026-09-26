import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
await mkdir('output/building-profile',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const wet=process.argv.includes('--wet');
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await routeBuildingDist(context);await blockPointerLock(context);
 const p=await context.newPage();await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await p.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await p.locator('#apprentice-count').selectOption('5');await p.locator('#start-button').click();
 await p.evaluate(()=>{const g=window.__wireTheHouse;g.player.camera.position.set(7.5,14.85,2.75);g.player.yaw=-1;g.player.pitch=.15;});await p.waitForTimeout(1500);
 if(wet){await p.evaluate(async()=>{const g=window.__wireTheHouse;g.player.camera.position.set(0,1.65,2);g.player.yaw=0;g.player.pitch=.15;g.roomWater.addFloorWater(0,0,12);await g.activateWaterPro();});await p.waitForTimeout(4000);}
 const cdp=await context.newCDPSession(p);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 const timings=await p.evaluate(async()=>{const g=window.__wireTheHouse,r=g.renderer,records={},restore=[];
  const wrap=(o,k,name)=>{if(typeof o?.[k]!=='function')return;const old=o[k];records[name]={n:0,total:0,max:0};o[k]=function(...a){const t=performance.now(),v=old.apply(this,a),d=performance.now()-t,s=records[name];s.n++;s.total+=d;s.max=Math.max(s.max,d);return v;};restore.push(()=>o[k]=old);};
  wrap(g,'step','step');wrap(r,'render','render');wrap(r.scene,'updateMatrixWorld','matrixWorld');wrap(r,'prepareMaterials','materials');wrap(r,'snapshotRenderCamera','camera');
  for(const k of ['_projectObject','_renderObjects','_renderScene'])wrap(r.webgl,k,k);
  for(const k of ['draw','beginRender','finishRender','copyTextureToBuffer'])wrap(r.webgl.backend,k,'backend.'+k);
  await new Promise(resolve=>setTimeout(resolve,3000));restore.reverse().forEach(f=>f());return records;
 });
 const {profile}=await cdp.send('Profiler.stop'),byId=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),totals=new Map();
 profile.samples.forEach((id,i)=>{const f=byId.get(id),key=f.functionName+' '+f.url.split('/').at(-1)+':'+f.lineNumber;totals.set(key,(totals.get(key)??0)+(profile.timeDeltas[i]??0));});
 const result={timings,hotspots:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,28)};await writeFile(`output/building-profile/hotspots${wet?'-wet':'-final'}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
