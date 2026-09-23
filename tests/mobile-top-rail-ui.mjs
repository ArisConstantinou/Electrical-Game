import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const base='https://arisconstantinou.github.io/Electrical-Game/';
const dist=resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.woff2':'font/woff2'};
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
await mkdir('output/mobile-top-rail-ui',{recursive:true});
try {
  for(const viewport of [{width:390,height:844},{width:320,height:740},{width:844,height:390}]) {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:2});
    await blockPointerLock(context);
    await context.addInitScript(()=>{
      localStorage.setItem('wirehouse:movement-stick-mode','floating');
      localStorage.removeItem('wirehouse:movement-stick-mode-version');
    });
    await context.route(`${base}**`,async route=>{
      const url=new URL(route.request().url()),path=resolve(dist,decodeURIComponent(url.pathname.slice('/Electrical-Game/'.length))||'index.html');
      if(!path.startsWith(dist))return route.abort();
      try{if(!(await stat(path)).isFile())return route.abort();await route.fulfill({status:200,contentType:mime[extname(path)]??'application/octet-stream',body:await readFile(path)});}catch{return route.abort();}
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'?renderer=webgl',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
    await page.locator('#start-button').tap();
    const name=`${viewport.width}x${viewport.height}`;
    await page.screenshot({path:`output/mobile-top-rail-ui/${name}-closed.png`});
    const closedRail=await page.locator('#mobile-top-rail').boundingBox();
    assert(closedRail&&closedRail.width<=34,'collapsed top rail still obscures the view');
    assert.equal(await page.locator('#site-pro-tools').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__wireTheHouse.movementStickMode),'fixed');
    const closed=await page.locator('#joystick').boundingBox();
    const cdp=await context.newCDPSession(page),x=closed.x+closed.width/2,y=closed.y+closed.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x+28,y:y-12}]});
    const held=await page.evaluate(()=>({rect:document.querySelector('#joystick').getBoundingClientRect().toJSON(),move:{...window.__wireTheHouse.input.mobileMove}}));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert(Math.abs(held.rect.x-closed.x)<1&&Math.abs(held.rect.y-closed.y)<1,'joystick base moved');
    assert(Math.hypot(held.move.x,held.move.y)>.1,'fixed joystick did not move player');
    await page.locator('#worker-bar-handle').tap();
    const worker=await page.evaluate(()=>{
      const ids=['mobile-top-rail','mobile-tool-slider','site-pro-tools','site-pro-coordinator','settings-toggle','worker-bar-handle','tool-quick-controls','aim-quick-controls'];
      return Object.fromEntries(ids.map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect();return[id,{x:r.x,y:r.y,w:r.width,h:r.height,display:getComputedStyle(el).display,parent:el.parentElement.id}]}));
    });
    assert.equal(await page.locator('#game-shell').getAttribute('data-tools-open'),'true');
    assert(Math.abs(worker['mobile-tool-slider'].y-worker['site-pro-tools'].y)<12);
    assert(Math.abs(worker['site-pro-tools'].y-worker['settings-toggle'].y)<1);
    assert.equal(worker['tool-quick-controls'].parent,'mobile-tool-slider');
    await page.screenshot({path:`output/mobile-top-rail-ui/${name}-worker.png`});
    const colorBefore=await page.locator('#quick-spray-color b').textContent();
    await page.locator('#quick-spray-color').scrollIntoViewIfNeeded();
    await page.locator('#quick-spray-color').tap();
    await page.waitForFunction(previous=>document.querySelector('#quick-spray-color b')?.textContent!==previous,colorBefore);
    assert.notEqual(await page.locator('#quick-spray-color b').textContent(),colorBefore,'contextual tool button did not work');
    await page.screenshot({path:`output/mobile-top-rail-ui/${name}-quick.png`});
    await page.locator('#site-pro-coordinator').tap();
    assert.equal(await page.locator('#game-shell').getAttribute('data-inspector-open'),'true');
    await page.screenshot({path:`output/mobile-top-rail-ui/${name}-inspector.png`});
    await page.locator('#inspector-bar-handle').tap();
    assert.equal(await page.locator('#game-shell').getAttribute('data-inspector-open'),'false');
    assert.equal(await page.locator('#mobile-top-rail').evaluate(el=>el.getBoundingClientRect().width<=34),true);
    assert.deepEqual(errors,[]);
    results.push({viewport,worker,joystickBase:closed,movedInput:held.move,errors});
    await context.close();
  }
  console.log(JSON.stringify({passed:true,results},null,2));
}finally{await browser.close();}
