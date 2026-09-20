import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv.find(value=>/^https?:/.test(value))??'http://127.0.0.1:5362/Electrical-Game/';
const out='output/mixing-tool-highlights';await mkdir(out,{recursive:true});
const report={url,cases:[],errors:[],passed:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});await page.locator('#start-button').click();await page.waitForTimeout(350);
  await page.evaluate(()=>{const game=window.__wireTheHouse;window.__highlightStep=game.step.bind(game);game.step=()=>{};});
  const step=(count=2)=>page.evaluate(frames=>{for(let i=0;i<frames;i++)window.__highlightStep(1/60);},count);
  const state=()=>page.evaluate(()=>window.__wireTheHouse.mixing.telemetry.toolHighlights);
  const aim=async tool=>page.evaluate(name=>{
    const game=window.__wireTheHouse,mixing=game.mixing,camera=game.renderer.camera,models=mixing.models;
    const root={water:models.water,trowel:mixing.stationTrowel,shovel:models.shovel,mixer:models.mixer}[name];
    models.group.updateMatrixWorld(true);
    const roots=[models.bucket,models.sand,...models.sacks,models.rinse,models.water,models.mixer,models.shovel,mixing.stationTrowel].filter(object=>object.visible);
    const points=[];root.traverse(object=>{if(object.isMesh&&!object.userData.mixingHighlight){object.geometry.computeBoundingBox();points.push(object.localToWorld(object.geometry.boundingBox.getCenter(camera.position.clone())));}});
    const station=models.group.getWorldPosition(camera.position.clone());
    const belongs=object=>{while(object){if(object===root)return true;object=object.parent;}return false;};
    for(const dz of [-.7,-1.0,-1.35,-1.7])for(const dx of [0,-.35,.35,-.7,.7])for(const height of [1.65,.95])for(const point of points){
      camera.position.set(station.x+dx,height,station.z+dz);camera.lookAt(point);camera.updateMatrixWorld(true);mixing.ray.setFromCamera({x:0,y:0},camera);
      const hit=mixing.ray.intersectObjects(roots,true).find(intersection=>!intersection.object.userData.mixingHighlight);
      const blocker=mixing.ray.intersectObject(game.room,true).find(intersection=>intersection.object.visible);
      if(hit&&hit.distance<=3.2&&belongs(hit.object)&&(!blocker||blocker.distance>=hit.distance-.001)){game.player.crouched=height===.95;game.player.yaw=camera.rotation.y;game.player.pitch=camera.rotation.x;return{camera:camera.position.toArray(),point:point.toArray(),distance:hit.distance};}
    }
    throw new Error(`No direct aim found for ${name}`);
  },tool);
  await step();const defaults=await state();
  assert.deepEqual(defaults.map(item=>item.tool),['water','trowel','shovel','mixer']);
  assert(defaults.every(item=>item.color==='yellow'),'Every available mixing tool starts yellow');
  for(const tool of ['water','trowel','shovel','mixer']){
    const evidence=await aim(tool);await step();const highlights=await state();
    assert.equal(highlights.find(item=>item.color==='blue')?.tool,tool,`Only aimed ${tool} becomes blue`);
    assert.equal(highlights.filter(item=>item.color==='blue').length,1);
    assert(highlights.filter(item=>item.tool!==tool).every(item=>item.color==='yellow'));
    await page.evaluate(async()=>{const renderer=window.__wireTheHouse.renderer;await renderer.waitForFrame();renderer.render();await renderer.waitForFrame();});
    await page.screenshot({path:`${out}/desktop-${tool}-blue.png`});
    report.cases.push({tool,evidence,highlights});
  }
  await page.evaluate(()=>{const game=window.__wireTheHouse,camera=game.renderer.camera;camera.lookAt(camera.position.clone().add({x:0,y:1,z:0}));camera.updateMatrixWorld(true);game.mixing.update(1/60,false,false);game.mixing.present();});
  const lookAway=await state();assert(lookAway.every(item=>item.color==='yellow'),'Looking away restores every outline to yellow');
  await page.evaluate(async()=>{const renderer=window.__wireTheHouse.renderer;await renderer.waitForFrame();renderer.render();await renderer.waitForFrame();});
  await page.screenshot({path:`${out}/desktop-look-away-yellow.png`});
  assert.deepEqual(report.errors,[]);report.lookAway=lookAway;report.passed=true;await context.close();
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.map(item=>item.tool),report:`${out}/report.json`}));
