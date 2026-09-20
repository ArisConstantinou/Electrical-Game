import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.env.QA_BASE??'http://127.0.0.1:5365/Electrical-Game/',out=process.argv[2]??'output/box-hand-assembly-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={url,mobileIsEmulation:true,cases:[],errors:[]};
const step=(page,n=2)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__boxAssemblyStep(1/60);},n);
async function fixture(page){return page.evaluate(async()=>{
  const g=window.__wireTheHouse,v=g.room.brickWall.volume;window.__boxAssemblyStep=g.step.bind(g);g.step=()=>{};await g.renderer.waitForFrame();
  const area={x:0,y:1.3,width:.58,height:.62,depth:.09},save=v.serialize(),chunks=new Map(save.chunks.map(c=>[c.key,new Map(c.edits.map(e=>[e[0],e]))]));let removed=0;
  for(let x=Math.max(1,Math.floor((area.x-area.width/2+v.width/2)/v.hx));x<=Math.ceil((area.x+area.width/2+v.width/2)/v.hx)+1;x++)for(let y=Math.floor((area.y-area.height/2)/v.hy);y<=Math.ceil((area.y+area.height/2)/v.hy)+1;y++)for(let z=1;z<=Math.ceil(area.depth/v.hz);z++){
    const p=v.nodePosition(x,y,z);if(Math.abs(p.x-area.x)>area.width/2||Math.abs(p.y-area.y)>area.height/2||!v.nodeMaterial(x,y,z))continue;
    const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`,index=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;
    if(!chunks.has(key))chunks.set(key,new Map());if(!chunks.get(key).has(index)){chunks.get(key).set(index,[index,255,1]);removed++;}
  }
  save.chunks=[...chunks].map(([key,edits])=>({key,edits:[...edits.values()]}));save.removedVolume=(save.removedVolume??0)+removed*v.nodeVolume;v.restore(save);g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
  const c=g.renderer.camera;c.position.set(0,g.player.eyeHeight,v.frontZ+.46);c.lookAt(0,1.3,v.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;return{removed};
});}
const read=page=>page.evaluate(()=>{
  const g=window.__wireTheHouse,state=JSON.parse(window.render_game_to_text()),zones=[];g.fpsRig.traverse(o=>{if(o.userData.zone)zones.push({zone:o.userData.zone,available:o.userData.available,visible:o.visible});});
  const boxScreenBounds=[];
  for(const root of [g.fpsRig.fittingAssemblyRoot,g.fpsRig.fittingCandidateRoot]){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    root.updateWorldMatrix(true,true);root.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=o.position.clone().set(a.getX(i),a.getY(i),a.getZ(i)).applyMatrix4(o.matrixWorld).project(g.renderer.renderCamera);minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);}});
    boxScreenBounds.push({minX,maxX,minY,maxY});
  }
  const arms=g.fpsRig.armSets.get('fitting')??[],legacySkinVisible=arms.some(a=>a.upper.visible||a.forearm.visible||a.hand.children.some(child=>child.visible&&!child.userData.heldAccessory));
  return{boxScreenBounds,worker:g.workerBody?.telemetry,legacySkinVisible,referenceKeys:g.fpsRig.anatomicalGrips().map(grip=>grip.referenceKey??null),selected:state.mission.selectedTool,assembly:state.mission.boxAssembly,arms:g.fpsRig.debugPose().arms,zones,fit:g.boxFitPreview.telemetry,visible:g.mission.points.filter(p=>p.boxGroup.visible).map(p=>({id:p.definition.id,layout:p.definition.boxLayout??p.boxGroup.layout,position:p.boxGroup.position.toArray()})),overflow:document.documentElement.scrollWidth>innerWidth,error:g.renderer.renderError};
});
try{
  for(const [name,viewport,mobile] of [['desktop',{width:1366,height:768},false],['mobile',{width:390,height:844},true]]){
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));page.on('console',message=>{if(message.type()==='error')report.errors.push(`${name}: ${message.text()}`);});await page.routeWebSocket('**',()=>{});
    await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,undefined,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();const prepared=await fixture(page);assert(prepared.removed>0);
    if(mobile)await page.locator('[data-tool="fitting"]').tap();else await page.keyboard.press('Digit5');await step(page,4);
    const initial=await read(page);assert.equal(initial.worker?.loaded,true,'new anatomical body must load alongside box assembly');assert.equal(initial.worker.bones,52);assert.equal(initial.legacySkinVisible,false,'legacy segmented skin must stay hidden');assert.deepEqual(initial.referenceKeys,[null,null],'independent fitting hands must not replay the old one-box reference');assert.equal(initial.selected,'fitting');assert.equal(initial.assembly.modules.length,1);assert.deepEqual(initial.arms.map(a=>a.gripRole).sort(),['assembly','candidate']);assert.equal(initial.zones.length,4);
    await page.waitForTimeout(1300);
    await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-initial-two-hands.png`});
    if(mobile){
      await page.locator('#box-next-kind').tap();await step(page);await page.locator('#box-rotate-candidate').tap();await step(page);await page.locator('[data-box-zone="2"]').tap();await step(page,30);
    }else{
      await page.mouse.move(viewport.width*.5,viewport.height*.5);await page.mouse.wheel(0,100);await step(page);
      for(const code of ['Digit2','Digit2','KeyR','Digit1']){await page.keyboard.press(code);await step(page,30);}
      await page.mouse.wheel(0,100);await step(page);
      for(const code of ['Digit1','Digit4']){await page.keyboard.press(code);await step(page,30);}
      await page.mouse.wheel(0,100);await step(page);await page.keyboard.press('Digit4');await step(page,30);await page.keyboard.press('KeyR');await step(page);await page.keyboard.press('Digit1');await step(page,30);await page.keyboard.press('Digit2');await step(page,30);
    }
    const built=await read(page);assert.equal(built.legacySkinVisible,false);assert.equal(built.worker.loaded,true);assert.equal(built.selected,'fitting','contextual digits cannot switch tools');assert(built.assembly.modules.length>=(mobile?2:8));assert.equal(built.zones.length,4);assert(!built.overflow);assert.equal(built.error,'');
    await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-built-puzzle.png`});
    for(const b of built.boxScreenBounds)assert(b.minX>=-1&&b.maxX<=1&&b.minY>=-1&&b.maxY<=1,`${name}: held gang boxes must stay fully inside the camera frame: ${JSON.stringify(b)}`);
    if(!mobile){
      await page.keyboard.press('Escape');await step(page,2);
      const escaped=await read(page);assert.equal(escaped.selected,'spray','Escape returns to the tool used before box assembly');
      assert.equal(escaped.assembly.modules.length,built.assembly.modules.length,'Escape preserves the held draft');
      await page.keyboard.press('Escape');await step(page,2);assert.equal((await read(page)).selected,'spray','Escape outside assembly does not switch tools');
      await page.mouse.move(viewport.width*.75,viewport.height*.6);await page.waitForTimeout(220);await page.mouse.wheel(0,100);await step(page,2);
      assert.equal((await read(page)).selected,'hammer','wheel returns to normal tool switching');
      await page.keyboard.press('Digit1');await step(page,2);assert.equal((await read(page)).selected,'spring','number keys return to normal tool selection');
      await page.keyboard.press('Digit5');await step(page,2);assert.equal((await read(page)).assembly.modules.length,built.assembly.modules.length,'re-entering assembly restores the draft');
    }
    await step(page,30);
    if(mobile)await page.locator('#box-place-assembly').tap();else await page.mouse.click(viewport.width*.5,viewport.height*.5,{button:'right'});await step(page,3);
    const placed=await read(page);assert.equal(placed.visible.length,1,`${name}: right-click/touch PLACE adds the complete assembly`);assert.equal(placed.visible[0].layout.length,built.assembly.modules.length);assert(!placed.overflow);assert.equal(placed.error,'');
    assert.equal(placed.assembly.modules.length,1,`${name}: successful placement starts a fresh one-box hand assembly`);
    await page.waitForTimeout(950);
    await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-placed.png`});
    report.cases.push({name,prepared,initial,built,placed});await context.close();
  }
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({passed:true,cases:report.cases.map(c=>({name:c.name,count:c.built.assembly.modules.length,placed:c.placed.visible.length}))}));
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
