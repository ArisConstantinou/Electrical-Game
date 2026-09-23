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
    assert(closedRail&&closedRail.width<=44,'collapsed top rail still obscures the view');
    const closedArrow=await page.locator('#worker-bar-handle svg').boundingBox();
    assert(closedArrow&&Math.abs(closedArrow.x+closedArrow.width/2-closedRail.x-closedRail.width/2)<1,'closed arrow is off-center');
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
    assert(worker['settings-toggle'].x+worker['settings-toggle'].w<=worker['worker-bar-handle'].x,'settings overlaps the arrow end cap');
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
    assert.equal(await page.locator('#mobile-top-rail').evaluate(el=>el.getBoundingClientRect().width<=44),true);
    await page.locator('#inspector-bar-handle').tap();
    await page.locator('#site-pro-tools').tap();
    await page.evaluate(()=>{
      const game=window.__wireTheHouse,mixing=game.mixing,camera=game.renderer.camera;
      game.step=()=>{};
      const station=mixing.models.group.getWorldPosition(camera.position.clone());
      camera.position.copy(station).add({x:0,y:1.65,z:-1.3});camera.updateMatrixWorld(true);
      mixing.setActive(true);mixing.update(1/60);mixing.present();
    });
    const mixingRail=await page.locator('#mixing-toolbelt').evaluate(rail=>{
      const bounds=rail.getBoundingClientRect(),role=document.querySelector('#site-pro-tools').getBoundingClientRect();
      return {hidden:rail.hidden,left:bounds.left,right:bounds.right,roleLeft:role.left,
        scrollWidth:rail.scrollWidth,clientWidth:rail.clientWidth,edge:rail.dataset.scrollEdge,
        labels:[...rail.querySelectorAll('button')].map(button=>button.getAttribute('aria-label'))};
    });
    assert.equal(mixingRail.hidden,false,'mixing tools are visible at the station');
    assert(mixingRail.right<=mixingRail.roleLeft,'mixing tools overlap the role controls');
    assert(mixingRail.labels.every(Boolean),'every icon-only mixing action needs an accessible name');
    if(mixingRail.scrollWidth>mixingRail.clientWidth+2){
      assert.equal(mixingRail.edge,'start','the rail must hint at further tools');
      await page.locator('#mixing-toolbelt').evaluate(rail=>{rail.scrollLeft=rail.scrollWidth-rail.clientWidth;});
      await page.waitForFunction(()=>document.querySelector('#mixing-toolbelt').dataset.scrollEdge==='end');
      const crouched=await page.evaluate(()=>window.__wireTheHouse.player.crouched);
      await page.locator('#mixing-stance').tap();
      assert.notEqual(await page.evaluate(()=>window.__wireTheHouse.player.crouched),crouched,'the last scrolled action must work');
    }else assert.equal(mixingRail.edge,'none','a fully visible rail needs no scroll hint');
    await page.screenshot({path:`output/mobile-top-rail-ui/${name}-mixing.png`});
    assert.deepEqual(errors,[]);
    results.push({viewport,worker,mixingRail,joystickBase:closed,movedInput:held.move,errors});
    await context.close();
  }
  console.log(JSON.stringify({passed:true,results},null,2));
}finally{await browser.close();}
