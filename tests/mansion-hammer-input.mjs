import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const dist = resolve('dist');
const live = process.argv.includes('--live');
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const context = await browser.newContext({viewport:{width:1366,height:768}});
  await blockPointerLock(context);
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp',
    '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
  if (!live) await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!file.startsWith(`${dist}\\`)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      await route.fulfill({status:200,contentType:mime[extname(file)] ?? 'application/octet-stream',body:await readFile(file)});
    } catch { await route.abort(); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(live ? 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl' : 'https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  await page.locator('#site-pro-desktop-tools [data-tool="hammer"]').click();
  await page.evaluate(()=>{
    const game=window.__wireTheHouse;
    game.hammerMode='demolish';
    game.renderer.camera.position.set(15.3,game.player.eyeHeight,15.0);
    game.player.yaw=Math.PI;
    game.player.pitch=0;
    game.renderer.camera.rotation.set(0,Math.PI,0);
  });
  const wallName='Courtyard north fired-clay enclosure';
  const before=await page.evaluate(name=>window.__wireTheHouse.room.mansionWing.masonryDemolition.get(name).removedClayNodes,wallName);
  await page.mouse.move(683,384);
  await page.mouse.down();
  await page.evaluate(()=>window.advanceTime(520));
  const halfway=await page.evaluate(name=>{const g=window.__wireTheHouse;return {nodes:g.room.mansionWing.masonryDemolition.get(name).removedClayNodes,held:g.input.actionHeld,status:g.fpsRig.contactStatus,cooldown:g.actionCooldown,aim:g.room.mansionWing.aimMasonry(g.renderer.camera)?.index??null};},wallName);
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.x+=.28;});
  await page.evaluate(()=>window.advanceTime(520));
  await page.mouse.up();
  const result=await page.evaluate(name=>{
    const game=window.__wireTheHouse,wall=game.room.mansionWing.masonryDemolition.get(name);
    return {removed:wall.removedIndices().length,partial:wall.partialDamageCount,nodes:wall.removedClayNodes,tool:game.selectedTool,contact:game.fpsRig.contactStatus,
      gripReach:game.fpsRig.gripsReachable(game.renderer.camera,game.fpsRig.tools.get('hammer')),
      position:game.renderer.camera.position.toArray(),renderError:game.renderer.renderError};
  },wallName);
  assert.equal(result.tool,'hammer');
  assert(result.nodes>before && result.partial>0,`Held mouse did not locally fracture courtyard masonry: ${JSON.stringify(result)}`);
  assert(result.nodes>halfway.nodes && result.gripReach,`Held hammer stopped or detached from hands before release: ${JSON.stringify({halfway,...result})}`);
  assert.equal(result.removed,0,'A single held strike must not remove whole bricks');
  assert.equal(result.renderError,'');
  assert.deepEqual(errors,[]);
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await blockPointerLock(mobileContext);
  if (!live) await mobileContext.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file=resolve(dist,decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length))||'index.html');
    if(!file.startsWith(`${dist}\\`))return route.abort();
    try{if(!(await stat(file)).isFile())return route.abort();
      await route.fulfill({status:200,contentType:mime[extname(file)]??'application/octet-stream',body:await readFile(file)});
    }catch{await route.abort();}
  });
  const mobile=await mobileContext.newPage();
  mobile.on('pageerror',error=>errors.push(error.message));
  await mobile.goto(live ? 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl' : 'https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl');
  await mobile.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
  await mobile.locator('#apprentice-count').selectOption('0');
  await mobile.locator('#start-button').tap();
  await mobile.locator('#worker-bar-handle').tap();
  await mobile.locator('#mobile-tool-slider [data-tool="hammer"]').tap();
  await mobile.evaluate(()=>{
    const game=window.__wireTheHouse;
    game.renderer.camera.position.set(15.3,game.player.eyeHeight,15.0);
    game.player.yaw=Math.PI;game.player.pitch=0;
    game.renderer.camera.rotation.set(0,Math.PI,0);
  });
  const use=await mobile.locator('#site-pro-use').boundingBox();
  assert(use,'Mobile USE target missing');
  const cdp=await mobileContext.newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:41,x:use.x+use.width/2,y:use.y+use.height/2}]});
  await mobile.evaluate(()=>window.advanceTime(520));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const mobileResult=await mobile.evaluate(name=>{
    const game=window.__wireTheHouse;
    return {removed:game.room.mansionWing.masonryDemolition.get(name).removedIndices().length,
      partial:game.room.mansionWing.masonryDemolition.get(name).partialDamageCount,
      nodes:game.room.mansionWing.masonryDemolition.get(name).removedClayNodes,
      tool:game.selectedTool,renderError:game.renderer.renderError};
  },wallName);
  assert.equal(mobileResult.tool,'hammer');
  assert(mobileResult.nodes>0 && mobileResult.partial>0,`Mobile held use did not locally fracture masonry: ${JSON.stringify(mobileResult)}`);
  assert.equal(mobileResult.removed,0,'Mobile held use must not remove whole bricks');
  assert.equal(mobileResult.renderError,'');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,desktop:{before,...result},mobile:mobileResult}));
} finally { await browser.close(); }
