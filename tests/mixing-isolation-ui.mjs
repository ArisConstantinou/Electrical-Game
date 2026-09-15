import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out='output/mixing-isolation-ui';await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,cases:[],errors:[],passed:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
const layouts=[{name:'desktop',viewport:{width:1366,height:768},mobile:false},{name:'mobile',viewport:{width:390,height:844},mobile:true}];
const near=(a,b,epsilon=.002)=>a.every((value,index)=>Math.abs(value-b[index])<epsilon);
try{
  for(const layout of layouts){
    const context=await browser.newContext({viewport:layout.viewport,isMobile:layout.mobile,hasTouch:layout.mobile,deviceScaleFactor:1});
    await blockPointerLock(context);const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});
    await page.locator('#start-button')[layout.mobile?'tap':'click']();
    await page.locator('#start-screen').waitFor({state:'hidden'});
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__isolationStep=g.step.bind(g);g.step=()=>{};});
    const step=(count=1)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__isolationStep(1/60);},count);
    const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{camera:g.renderer.camera.position.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,active:g.mixing.active,mixTool:g.mixing.tool,selected:g.selectedTool,batch:g.mixing.batch.getState(),mixing:g.mixing.telemetry.mixing,station:g.mixing.models.group.getWorldPosition(g.renderer.camera.position.clone()).toArray(),room:{width:g.room.children.find(o=>o.name==='Rough unfinished concrete floor').geometry.parameters.width,depth:g.room.children.find(o=>o.name==='Rough unfinished concrete floor').geometry.parameters.depth},wall:g.room.brickWall.volume.frontZ,mortar:g.mortar.telemetry,overflow:document.documentElement.scrollWidth>innerWidth,interactVisible:document.querySelector('#mobile-interact').checkVisibility(),renderError:g.renderer.renderError};});
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,p=g.mixing.models.group.getWorldPosition(c.position.clone());c.position.set(p.x,g.player.eyeHeight,p.z-.9);c.lookAt(p.x,.4,p.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step();
    const initial=await state();assert.equal(initial.room.width,7.6);assert.equal(initial.room.depth,7.2);assert(initial.station[2]-initial.wall>4.5,'Station must be far behind the work wall');
    if(layout.mobile){
      const pad=await page.locator('#look-joystick').boundingBox();assert(pad);await page.touchscreen.tap(pad.x+pad.width/2,pad.y+pad.height/2);
    }else await page.locator('#game-canvas').click({position:{x:900,y:420}});
    await step(2);assert.equal((await state()).active,false,'Normal tool USE must not open the mixing station');
    await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
    await page.screenshot({path:`${out}/${layout.name}-station-ready.png`});
    if(layout.mobile){assert.equal((await state()).interactVisible,true);await page.locator('#mobile-interact').tap();}else await page.keyboard.press('KeyE');
    await step(2);const opened=await state();assert.equal(opened.active,true,'Only contextual INTERACT opens the station');assert(near(opened.camera,initial.camera),'Opening station must not teleport the camera');
    await page.locator('[data-mix-tool="trowel"]').click();await step();await page.locator('[data-mix-action="cement"]').click();await step();
    const mixingTrowel=await state();assert.equal(mixingTrowel.mixTool,'trowel');assert.equal(mixingTrowel.batch.sacks[0].open,true);assert(near(mixingTrowel.camera,initial.camera),'Mixing trowel animation must not move the player');
    await page.locator('[data-mix-tool="mixer"]').click();await step();await page.locator('[data-mix-action="insert"]').click();await step();
    const inserted=await state();assert.equal(inserted.active,true);assert(near(inserted.camera,initial.camera),'Inserting mixer must not teleport or lock the player');
    if(layout.mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');
    await step();const wallMode=await state();assert.equal(wallMode.active,false);assert.equal(wallMode.selected,'trowel');assert(near(wallMode.camera,initial.camera),'Selecting wall trowel must not move back to the station');
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.72);c.lookAt(0,1.35,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step();
    const beforeWall=await state();
    if(layout.mobile){
      const cdp=await context.newCDPSession(page),box=await page.locator('#look-joystick').boundingBox();assert(box);const point={x:box.x+box.width/2,y:box.y+box.height/2,id:47};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await step(28);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{await page.keyboard.down('KeyE');await step(28);await page.keyboard.up('KeyE');}
    await step(70);const afterWall=await state();assert.equal(afterWall.active,false,'Wall work must not reactivate the distant station');assert(afterWall.mortar.launchedKg>beforeWall.mortar.launchedKg,'The original wall trowel must still launch mortar');assert(near(afterWall.camera,beforeWall.camera,.01),'Wall trowel animation must not move the camera');assert.equal(afterWall.overflow,false);assert.equal(afterWall.renderError,'');assert.deepEqual(errors,[]);
    await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});
    await page.screenshot({path:`${out}/${layout.name}-wall-trowel.png`});
    report.cases.push({platform:layout.name,initial,opened,mixingTrowel,inserted,wallMode,beforeWall,afterWall,errors});await context.close();
  }
  report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,report:`${out}/report.json`,platforms:report.cases.map(item=>item.platform)}));
