import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/building-profile';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('5');await page.locator('#start-button').click();
 for(const pose of [{name:'original',x:0,y:1.65,z:2,yaw:0},{name:'courtyard',x:12,y:1.65,z:14.4,yaw:1.8},{name:'L4',x:7.5,y:14.85,z:2.75,yaw:-1}]){
  await page.evaluate(p=>{const g=window.__wireTheHouse;g.player.camera.position.set(p.x,p.y,p.z);g.player.yaw=p.yaw;g.player.pitch=.15;g.selectedTool='spray';g.fpsRig.show('spray');},pose);await page.waitForTimeout(1500);
  results.push(await page.evaluate(async p=>{
   const g=window.__wireTheHouse,records={},restore=[];
   const wrap=(obj,key,name)=>{if(typeof obj?.[key]!=='function')return;const old=obj[key];records[name]=[];obj[key]=function(...args){const start=performance.now();const r=old.apply(this,args);records[name].push(performance.now()-start);return r;};restore.push(()=>obj[key]=old);};
   for(const key of ['room','player','masonryBatch','siteOcclusion','mixing','workerBody','fpsRig','apprentice','roomWater','pvc','hud','mortar','boxPlacement'])wrap(g[key],'update',key);
   for(const key of ['surfaceHeight','obstaclesAt','aimMasonry','updateGameplayVisibility'])wrap(g.room.mansionWing,key,key);
   wrap(g.renderer,'render','render');wrap(g,'step','step');
   await new Promise(resolve=>setTimeout(resolve,4500));restore.reverse().forEach(fn=>fn());
   const stats=Object.fromEntries(Object.entries(records).map(([name,values])=>{values.sort((a,b)=>a-b);return [name,{n:values.length,mean:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),max:values.at(-1),total:values.reduce((a,b)=>a+b,0)}]}));
   const meshes=[];g.renderer.scene.traverseVisible(o=>{if(o.isMesh&&o.layers.test(g.renderer.camera.layers)){meshes.push({name:o.name,parent:o.parent?.name,triangles:(o.geometry.index?.count??o.geometry.attributes.position?.count??0)/3*(o.isInstancedMesh?o.count:1)});}});
   return {name:p.name,stats,heaviest:meshes.sort((a,b)=>b.triangles-a.triangles).slice(0,15),totalMeshes:meshes.length};
  },pose));
 }
}finally{await browser.close();}
await writeFile(`${out}/${process.argv[2]??'before'}.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({name:r.name,stats:r.stats,heaviest:r.heaviest.slice(0,5)})),null,2));
