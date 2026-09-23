import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const dist = resolve('dist');
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const context = await browser.newContext({viewport:{width:1366,height:768}});
  await blockPointerLock(context);
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp',
    '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
  await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!file.startsWith(`${dist}\\`)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      await route.fulfill({status:200,contentType:mime[extname(file)] ?? 'application/octet-stream',body:await readFile(file)});
    } catch { await route.abort(); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  await page.locator('#site-pro-desktop-tools [data-tool="hammer"]').click();
  await page.evaluate(()=>{
    const game=window.__wireTheHouse;
    game.renderer.camera.position.set(15.3,game.player.eyeHeight,15.0);
    game.player.yaw=Math.PI;
    game.player.pitch=0;
    game.renderer.camera.rotation.set(0,Math.PI,0);
  });
  const wallName='Courtyard north fired-clay enclosure';
  const before=await page.evaluate(name=>window.__wireTheHouse.room.mansionWing.masonryDemolition.get(name).removedIndices().length,wallName);
  await page.mouse.move(683,384);
  await page.mouse.down();
  await page.evaluate(()=>window.advanceTime(520));
  await page.mouse.up();
  const result=await page.evaluate(name=>{
    const game=window.__wireTheHouse,wall=game.room.mansionWing.masonryDemolition.get(name);
    return {removed:wall.removedIndices().length,tool:game.selectedTool,contact:game.fpsRig.contactStatus,
      position:game.renderer.camera.position.toArray(),renderError:game.renderer.renderError};
  },wallName);
  assert.equal(result.tool,'hammer');
  assert(result.removed>before,`Held mouse did not demolish courtyard masonry: ${JSON.stringify(result)}`);
  assert.equal(result.renderError,'');
  assert.deepEqual(errors,[]);
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await blockPointerLock(mobileContext);
  await mobileContext.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file=resolve(dist,decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length))||'index.html');
    if(!file.startsWith(`${dist}\\`))return route.abort();
    try{if(!(await stat(file)).isFile())return route.abort();
      await route.fulfill({status:200,contentType:mime[extname(file)]??'application/octet-stream',body:await readFile(file)});
    }catch{await route.abort();}
  });
  const mobile=await mobileContext.newPage();
  mobile.on('pageerror',error=>errors.push(error.message));
  await mobile.goto('https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl');
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
      tool:game.selectedTool,renderError:game.renderer.renderError};
  },wallName);
  assert.equal(mobileResult.tool,'hammer');
  assert(mobileResult.removed>0,`Mobile held use did not demolish masonry: ${JSON.stringify(mobileResult)}`);
  assert.equal(mobileResult.renderError,'');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,desktop:{before,...result},mobile:mobileResult}));
} finally { await browser.close(); }
