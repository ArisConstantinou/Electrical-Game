import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const out=path.resolve(process.env.QA_OUTPUT??'output/water-first-use');await mkdir(out,{recursive:true});
const report={fixture:'Normal game clock, five apprentices, native tool selection and held mouse/touch toggle USE. Camera placement only; no injected water or render/physics substitutes. Mobile is desktop emulation.',cases:[],errors:[]};
const s=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
try{await runManagedClient(s,300000,async()=>{for(const mobile of [false,true]){
 const ctx=await s.browser.newContext({viewport:mobile?{width:390,height:844}:{width:2560,height:1440},deviceScaleFactor:mobile?3:1,isMobile:mobile,hasTouch:mobile});await blockPointerLock(ctx);await routeBuildingDist(ctx);
 const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto('http://127.0.0.1:5365/Electrical-Game/'+(mobile?'?renderer=webgl':''));await p.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await p.locator('#apprentice-count').selectOption('5');await p.locator('#start-button').click();
 if(mobile){await p.locator('#worker-bar-handle').tap();await p.locator('#mobile-tool-slider [data-tool="hose"]').tap();}else await p.keyboard.press('Digit8');
 await p.evaluate(()=>{const g=window.__wireTheHouse;g.player.camera.position.set(-1.5,1.65,g.room.brickWall.volume.frontZ+.8);g.player.yaw=0;g.player.pitch=-.8;
  window.__largeReads=[];const get=CanvasRenderingContext2D.prototype.getImageData;CanvasRenderingContext2D.prototype.getImageData=function(...a){if(a[2]>=2048&&a[3]>=2048)window.__largeReads.push({width:a[2],height:a[3],at:performance.now()});return get.apply(this,a);};
  const r=g.renderer,draw=r.drawScene;window.__waterFrames=[];r.drawScene=function(...a){const result=draw.apply(this,a);window.__waterFrames.push(performance.now());return result;};window.__waterFirstAt=performance.now();
 });await p.waitForTimeout(500);await p.screenshot({path:out+'/'+(mobile?'mobile':'desktop')+'-before.png'});
 const use=async()=>{if(mobile){const b=await p.locator('#look-joystick').boundingBox();await p.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else{await p.mouse.move(1280,720);await p.mouse.down();}};
 await use();await p.waitForFunction(()=>window.__wireTheHouse.roomWater.waterProActive,null,{timeout:90000});await p.waitForTimeout(4000);
 if(mobile)await use();else await p.mouse.up();await p.waitForTimeout(500);
 const result=await p.evaluate(()=>{const g=window.__wireTheHouse,w=g.roomWater,t=window.__waterFrames,intervals=t.slice(1).map((v,i)=>v-t[i]),surface=g.renderer.scene.getObjectByName('Water Pro finite room flooding surface');return{atlasReads:window.__largeReads,maxFrameGapMs:Math.max(...intervals),submittedFrames:t.length,elapsedMs:performance.now()-window.__waterFirstAt,water:w.telemetry,optics:surface.userData.waterPro,nozzleError:w.jetState.origin.distanceTo(g.fpsRig.toolTipWorld(g.renderer.camera,'hose')),held:g.input.actionHeld,count:g.apprentice.count,error:g.renderer.renderError,overflow:document.documentElement.scrollWidth>innerWidth};});
 report.cases.push({mobile,...result});await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({mobile,atlasReads:result.atlasReads.length,gapMs:result.maxFrameGapMs,floorLitres:result.water.floorLitres,error:result.error}));
 assert.equal(result.atlasReads.length,0,'Disabled ocean spray must not allocate/read its eight 2048px sprite layers');assert(result.water.active);assert(result.water.floorLitres>0);assert(Math.abs(result.water.conservationErrorLitres)<1e-5);assert.equal(result.count,5);assert.equal(result.held,false);assert.equal(result.water.jetActive,false);assert(result.nozzleError<.0005);assert.equal(result.error,'');assert.equal(result.overflow,false);
 await p.screenshot({path:out+'/'+(mobile?'mobile':'desktop')+'-after.png'});await ctx.close();
 }assert.deepEqual(report.errors,[]);});}catch(e){report.failure=String(e.stack??e);throw e;}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
