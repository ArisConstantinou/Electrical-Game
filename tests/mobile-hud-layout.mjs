import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/',out=process.argv[3]??'output/mobile-hud-layout';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,method:'Native touch/click tool selection and direct setting buttons; no physical Pointer Lock, browser closed after all cases.',cases:[],errors:[]};
const layouts=[{name:'portrait',width:390,height:844,mobile:true},{name:'landscape',width:844,height:390,mobile:true},{name:'compact-portrait',width:320,height:740,mobile:true},{name:'compact-landscape',width:667,height:375,mobile:true},{name:'desktop',width:1366,height:768,mobile:false}];
try{for(const layout of layouts){
 if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==layout.name)continue;
 const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:layout.mobile,hasTouch:layout.mobile});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push({platform:layout.name,message:e.message}));
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,null,{timeout:120000});const click=async selector=>{await page.locator(selector).scrollIntoViewIfNeeded();await page.locator(selector)[layout.mobile?'tap':'click']();};await click('#start-button');await page.waitForTimeout(450);
 const tools={hammer:'Digit4',trowel:'Digit7',hose:'Digit8',spray:'Digit3'};
 for(const [tool,key] of Object.entries(tools)){
  if(layout.mobile){if(!await page.locator('#mobile-tool-slider').isVisible())await click('#site-pro-tools');await click(`#mobile-tool-slider [data-tool="${tool}"]`);}else await page.keyboard.press(key);
  await page.waitForFunction(tool=>window.__wireTheHouse.selectedTool===tool&&document.querySelector('#game-shell').dataset.activeTool===tool,tool);
  if(layout.mobile)await click('#site-pro-tools');
  await page.waitForTimeout(150);
  const state=await page.evaluate(()=>{
   const bounds=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
   const visible=e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
   return{tool:window.__wireTheHouse.selectedTool,settingsOpen:document.querySelector('#settings-toggle').getAttribute('aria-expanded'),pointerLock:document.pointerLockElement?.id??null,renderError:window.__wireTheHouse.renderer.renderError,overflow:document.documentElement.scrollWidth>innerWidth,
    buttons:[...document.querySelectorAll('#tool-quick-controls button,#aim-quick-controls button')].filter(visible).map(e=>({id:e.id,text:e.innerText,...bounds(e),font:Math.min(...[...e.querySelectorAll('span,b')].filter(visible).map(n=>parseFloat(getComputedStyle(n).fontSize)))})),
    status:bounds(document.querySelector('#mobile-use-status')),rails:['#tool-quick-controls','#aim-quick-controls','#mobile-tool-slider'].map(id=>({id,...bounds(document.querySelector(id))})),look:bounds(document.querySelector('#look-joystick')),lookRadius:getComputedStyle(document.querySelector('#look-joystick')).borderRadius,use:bounds(document.querySelector('#site-pro-use')),actionText:document.querySelector('#mobile-action').textContent,oldAutoMenu:!!document.querySelector('#aim-control-mode'),aimMode:window.__wireTheHouse.aimInputMode,settings:bounds(document.querySelector('#settings-toggle')),
   };
  });
  report.cases.push({layout:layout.name,tool,state});
  assert(!state.overflow);assert.equal(state.renderError,'');assert.equal(state.pointerLock,null);assert.equal(state.settingsOpen,'false');assert(!state.oldAutoMenu);assert.equal(state.actionText,'AIM');
  if(layout.mobile){
   assert(state.use.width>=44&&state.use.height>=44,`${layout.name}: USE target too small`);
   for(const b of state.rails)assert(!(state.status.x<b.right&&state.status.right>b.x&&state.status.y<b.bottom&&state.status.bottom>b.y),`${layout.name}: use status overlaps ${b.id}`);
   assert(Math.abs(state.look.width-state.look.height)<.5,'AIM control is not circular');assert.equal(state.lookRadius,'50%');
   for(const b of state.buttons){assert(b.width>=44&&b.height>=44,`${b.id} touch target too small`);assert(b.font>=12,`${b.id} text too small`);}
   if(tool==='hammer')for(const id of ['quick-chisel-width','quick-chisel-tilt','quick-hammer-side','quick-hammer-speed']){
    const button=page.locator(`#${id}`);await button.scrollIntoViewIfNeeded();const b=await button.boundingBox();
    assert(b&&b.width>=44&&b.height>=44&&b.x>=0&&b.x+b.width<=layout.width,`${layout.name}: essential ${id} cannot be reached`);
    assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest(`#${el.id}`)===el;}),`${layout.name}: essential ${id} is covered`);
   }
   const center={x:layout.width*.32,right:layout.width*.68,y:layout.height*.33,bottom:layout.height*.62};
   for(const b of state.buttons.filter(b=>b.x>=0&&b.right<=layout.width))assert(!(b.x<center.right&&b.right>center.x&&b.y<center.bottom&&b.bottom>center.y),`${layout.name}: ${b.id} covers central wall`);
   const expected={hammer:['quick-chisel-width','quick-chisel-tilt','quick-hammer-side','quick-hammer-speed'],spray:['quick-tool-mode','quick-spray-color'],hose:['quick-water-flow'],trowel:['quick-loft-down','quick-loft-up','quick-work-height']};
   for(const id of expected[tool])assert(state.buttons.some(b=>b.id===id),`${tool}: ${id} missing`);
   if(tool==='hammer'){
    const settingsSnapshot=()=>page.evaluate(()=>JSON.stringify({width:window.__wireTheHouse.room.brickWall.chiselWidthM,tilt:window.__wireTheHouse.room.brickWall.chiselTiltDegrees,side:window.__wireTheHouse.room.brickWall.chiselSideDegrees,speed:window.__wireTheHouse.hammerSpeed}));
    const beforeSwipe=await settingsSnapshot(),cdp=await context.newCDPSession(page),first=await page.locator('#quick-chisel-width').boundingBox();
    const x=first.x+first.width/2,y=first.y+first.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(const dx of [8,16,25,16,8,0]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);await cdp.detach();
    assert.equal(await settingsSnapshot(),beforeSwipe,'Rail swipe changed tool settings');
    const before=await page.evaluate(()=>({width:window.__wireTheHouse.room.brickWall.chiselWidthM,tilt:window.__wireTheHouse.room.brickWall.chiselTiltDegrees,side:window.__wireTheHouse.room.brickWall.chiselSideDegrees,speed:window.__wireTheHouse.hammerSpeed,impacts:window.__wireTheHouse.room.brickWall.impactCount}));
    for(const id of ['quick-chisel-width','quick-chisel-tilt','quick-hammer-side','quick-hammer-speed'])await click(`#${id}`);
    await page.waitForTimeout(120);
    const after=await page.evaluate(()=>({width:window.__wireTheHouse.room.brickWall.chiselWidthM,tilt:window.__wireTheHouse.room.brickWall.chiselTiltDegrees,side:window.__wireTheHouse.room.brickWall.chiselSideDegrees,speed:window.__wireTheHouse.hammerSpeed,impacts:window.__wireTheHouse.room.brickWall.impactCount}));
    for(const key of ['width','tilt','side','speed'])assert.notEqual(before[key],after[key],`Quick ${key} had no effect`);
    assert.equal(after.impacts,before.impacts,'Changing settings used hammer');
    const crouched=await page.evaluate(()=>window.__wireTheHouse.player.crouched);await click('#quick-work-height');await page.waitForFunction(before=>window.__wireTheHouse.player.crouched!==before,crouched);assert.equal(await page.locator('#quick-work-height b').textContent(),crouched?'CROUCH':'STAND');await click('#quick-work-height');await page.waitForFunction(before=>window.__wireTheHouse.player.crouched===before,crouched);await page.locator('#quick-chisel-width').scrollIntoViewIfNeeded();
    const mode=await page.evaluate(()=>window.__wireTheHouse.aimInputMode);await click('#quick-aim-input');await page.waitForFunction(mode=>window.__wireTheHouse.aimInputMode!==mode,mode);await click('#quick-aim-input');await page.waitForFunction(mode=>window.__wireTheHouse.aimInputMode===mode,mode);
    const speed=await page.evaluate(()=>window.__wireTheHouse.aimProfile);await click('#quick-aim-speed');await page.waitForFunction(speed=>window.__wireTheHouse.aimProfile!==speed,speed);
   }
  }else assert.equal(state.buttons.length,0,'Mobile quick controls leaked onto desktop');
  await page.screenshot({path:`${out}/${layout.name}-${tool}.png`});
 }
 await context.close();console.log(JSON.stringify({layout:layout.name,passed:true}));
}assert.deepEqual(report.errors,[]);report.passed=true;}catch(e){report.failure=String(e.stack??e);throw e;}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
