import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/building-batch-render';await mkdir(out,{recursive:true});const report={cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 for(const pose of [{name:'street',x:23,y:1.65,z:-14,yaw:2.54},{name:'stairs',x:3.1,y:1.65,z:12.9,yaw:-1.05},{name:'L4',x:7.5,y:14.85,z:2.75,yaw:-1}]){
  await page.evaluate(p=>{const g=window.__wireTheHouse;if(window.__batchStep)g.step=window.__batchStep;g.player.camera.position.set(p.x,p.y,p.z);g.player.yaw=p.yaw;g.player.pitch=.15;},pose);await page.waitForTimeout(700);
  const state=await page.evaluate(async()=>{
   const g=window.__wireTheHouse;window.__batchStep=g.step;g.step=()=>{};g.siteOcclusion.restore();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();
   const b=g.masonryBatch;let expected=0,actual=0;
   for(const batch of b.batches){const storage=b.storage.get(batch),sources=storage.sources.filter(s=>s.batched);const count=sources.reduce((n,s)=>n+s.matrices.length,0);expected+=count;actual+=batch.count;
    if(count!==batch.count)throw new Error('Compaction count mismatch');let next=0;
    for(const source of sources)for(let i=0;i<source.matrices.length;i++,next++){
     for(let c=0;c<16;c++)if(batch.instanceMatrix.array[next*16+c]!==storage.matrices[(source.start+i)*16+c])throw new Error('Instance matrix mismatch');
     for(let c=0;c<3;c++)if(batch.instanceColor.array[next*3+c]!==storage.colors[(source.start+i)*3+c])throw new Error('Instance color mismatch');
     if(storage.patches)for(let c=0;c<4;c++)if(batch.geometry.attributes.brickPatch.array[next*4+c]!==storage.patches[(source.start+i)*4+c])throw new Error('Brick patch mismatch');
    }
   }
   return {instances:actual,expected,calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,constructionSources:b.construction.sources.size,constructionBatches:b.construction.batches.length};
  });
  await page.screenshot({path:`${out}/${pose.name}-batched.png`});
  await page.evaluate(async()=>{const g=window.__wireTheHouse;g.masonryBatch.disableForEditor();g.room.invalidateSunShadow();g.renderer.render();await g.renderer.waitForFrame();});
  await page.screenshot({path:`${out}/${pose.name}-authored.png`});
  report.cases.push({name:pose.name,...state});
 }
 // Hiding a source in the editor must survive rebuilding the batches.
 report.editorHiddenPreserved=await page.evaluate(()=>{const g=window.__wireTheHouse,b=g.masonryBatch;const source=[...b.construction.sources.keys()][0];source.visible=false;b.update(g.renderer.camera);return !source.visible&&!b.construction.sources.has(source);});
 assert(report.editorHiddenPreserved);assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
