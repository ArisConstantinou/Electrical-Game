import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const dist=resolve('dist'), browser=await chromium.launch({ channel:'chrome', headless:true });
try {
  const context=await browser.newContext({ viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true });
  await blockPointerLock(context);
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.svg':'image/svg+xml'};
  await context.route('https://arisconstantinou.github.io/Electrical-Game/**',async route=>{
    const file=resolve(dist,decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length))||'index.html');
    if(!file.startsWith(`${dist}\\`))return route.abort();
    try{if(!(await stat(file)).isFile())return route.abort();await route.fulfill({status:200,contentType:mime[extname(file)]??'application/octet-stream',body:await readFile(file)});}
    catch{return route.abort();}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://arisconstantinou.github.io/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
  await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
  const out=resolve('output/workroom-chase-depth');await mkdir(out,{recursive:true});
  await page.evaluate(()=>{const game=window.__wireTheHouse,camera=game.renderer.camera,front=game.room.brickWall.volume.frontZ;game.step=()=>{};game.fpsRig.visible=false;camera.position.set(0,1.55,front+.8);camera.lookAt(0,1.55,front);game.renderer.render();});
  await page.locator('#game-canvas').screenshot({path:resolve(out,'before.png')});
  const chased=await page.evaluate(async()=>{
    const game=window.__wireTheHouse,wall=game.room.brickWall,volume=wall.volume,camera=game.renderer.camera;
    window.__baselineChaseVolume=volume.serialize();const point=game.mission.activePoint??game.mission.points[0];
    const strikePoint={x:0,y:1.55,z:volume.frontZ};
    wall.contactProvider=()=>({point:camera.position.clone().set(strikePoint.x,strikePoint.y,strikePoint.z),direction:camera.position.clone().set(0,0,-1),edge:camera.position.clone().set(1,0,0),energyJ:6,chisel:'flat',widthM:.045});
    game.interaction.setHammerMode('chase');
    const action=game.interaction.action(point,'hammer',camera);
    const strikeMs=[];
    for(const y of [1.94,1.88,1.82,1.76,1.70,1.64,1.58,1.52,1.46,1.40,1.34,1.28,1.22,1.16])
      for(const x of [-.025,0,.025]){
        strikePoint.x=x;strikePoint.y=y;
        const started=performance.now();wall.recessChaseAtAim(camera,point.definition.id);strikeMs.push(performance.now()-started);
      }
    const depthOf=()=>{
      let deepest=0;
      for(const chunk of volume.serialize().chunks){
        const [tx,ty]=chunk.key.split(',').map(Number);
        for(const [offset,,removed] of chunk.edits){if(!removed)continue;
          const z=offset%(volume.nz+2),xy=Math.floor(offset/(volume.nz+2));
          const x=tx*volume.tileSize+xy%volume.tileSize,y=ty*volume.tileSize+Math.floor(xy/volume.tileSize);
          deepest=Math.max(deepest,volume.frontZ-volume.nodePosition(x,y,z).z);
        }
      }
      return deepest;
    };
    strikeMs.sort((a,b)=>a-b);
    await wall.waitForGeometry();game.renderer.render();await game.renderer.waitForFrame();
    return {action:action.success,nodes:volume.removedNodeCount,depth:depthOf(),p95StrikeMs:strikeMs[Math.floor(strikeMs.length*.95)],maxStrikeMs:strikeMs.at(-1)};
  });
  await page.locator('#game-canvas').screenshot({path:resolve(out,'after.png')});
  const demolish=await page.evaluate(()=>{
    const game=window.__wireTheHouse,wall=game.room.brickWall,volume=wall.volume,camera=game.renderer.camera,point=game.mission.activePoint??game.mission.points[0];
    volume.restore(window.__baselineChaseVolume);wall.flushGeometry();
    game.interaction.setHammerMode('demolish');
    let unrestricted=false;
    const impact=volume.impact.bind(volume);
    volume.impact=input=>{unrestricted=input.maxDepthM===undefined;return impact(input);};
    const demo=game.interaction.action(point,'hammer',camera);
    return {action:demo.success,unrestricted};
  });
  const result={chased,demolish,screenshots:out};
  assert(result.chased.action&&result.chased.nodes>0&&result.chased.depth<=.108,JSON.stringify(result));
  assert(result.demolish.action&&result.demolish.unrestricted,JSON.stringify(result));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(result));
} finally {await browser.close();}
