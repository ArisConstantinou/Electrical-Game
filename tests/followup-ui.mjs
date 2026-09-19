import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const baseline=process.argv.includes('--baseline'),url='http://127.0.0.1:5364/Electrical-Game/',out=`output/followup-ui-${baseline?'before':'after'}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={url,baseline,cases:[]};
try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(page.context());await page.routeWebSocket('**',()=>{});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=array=>array instanceof Uint32Array&&array.length===1?(array[0]=260913,array):original(array);});
 if(baseline)for(const path of ['src/systems/MortarSystem.ts','src/systems/MortarField.ts','src/systems/ChasingSystem.ts','src/systems/BoxFitPreview.ts','src/ui/HUD.ts']){
  const original=execFileSync('git',['show',`d8bd3a8:${path}`],{encoding:'utf8'});
  await page.route(`**/${path}*`,async route=>{const response=await route.fetch(),live=await response.text(),three=live.match(/import \* as THREE from ["']([^"']+)["']/)?.[1];const body=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(from\s+|import\s+)(["'])([^"']+)\2/g,(all,prefix,quote,specifier)=>`${prefix}${quote}${specifier==='three'?three:specifier.startsWith('.')?new URL(specifier+'.ts',route.request().url()).pathname:specifier}${quote}`);await route.fulfill({response,body,contentType:'application/javascript'});});
 }
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);await page.locator('#start-button')[mobile?'tap':'click']();await page.waitForTimeout(400);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.__followStep=g.step.bind(g);g.step=()=>{};});await prepareFinishedMortar(page);
 const step=n=>page.evaluate(n=>{const g=window.__wireTheHouse;window.__followTrace??=[];for(let i=0;i<n;i++){window.__followStep(1/60);window.__followTrace.push({frame:window.__followTrace.length,mass:g.mortar.stuckMass,skin:g.mortar.deposits.map(d=>d.mesh.geometry.id).join(','),pending:g.mortar.pendingGeometryChunks});}},n);
 const aim=async(x,y)=>{await page.evaluate(([x,y])=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(x,1.65,g.room.brickWall.volume.frontZ+.52);c.lookAt(x,y,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},[x,y]);await step(6);};
 const tool=async(name,key)=>{if(mobile)await page.locator(`[data-tool="${name}"]`).tap();else await page.keyboard.press(key);await step(2);};
 const cdp=mobile?await page.context().newCDPSession(page):null;
 const hold=async down=>{if(cdp){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x:b.x+b.width/2,y:b.y+b.height/2,id:41}]:[]});}else{await page.mouse.move(900,350);await page.mouse[down?'down':'up']();}};
 const capture=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});};
 await tool('trowel','Digit7');await aim(0,1.4);await hold(true);await step(28);await hold(false);await step(24);await hold(true);await step(40);
 const rearm=await page.evaluate(()=>window.__wireTheHouse.mortar.throwFeedback),impact=await page.evaluate(()=>{const t=window.__followTrace,i=t.findIndex((f,k)=>k&&f.mass>t[k-1].mass+.01),visible=t.findIndex((f,k)=>k>=i&&f.skin!==t[i-1]?.skin);return{impactFrame:i,visibleFrame:visible,delayFrames:visible-i};});await capture('repress');await hold(false);await step(70);
 await page.evaluate(async()=>{const g=window.__wireTheHouse,m=g.mortar,V=g.renderer.camera.position.constructor,f=g.room.brickWall.volume.frontZ;for(let x=-.4;x<=.4001;x+=.1)for(let y=1.15;y<=1.7501;y+=.1){const held=m.deposit(new V(x,y,f),.65,new V(0,0,1),false,1.69);m.stuckMass+=held;m.launchedMass+=held;}for(let i=0;i<20;i++)m.update(1/60);await m.waitForGeometry();});
 await tool('fitting','Digit5');await page.locator('[data-box-preset="2G+1G"]')[mobile?'tap':'click']();await aim(0,1.4);await capture('empty-bed');
 const fit=await page.evaluate(()=>window.__wireTheHouse.boxFitPreview.telemetry);await hold(true);await step(1);await hold(false);await step(1);await capture('box-immediate');
 const placed=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points.find(p=>p.boxGroup.visible);return{visible:!!p,width:p?.boxGroup.groupWidth,pending:g.mortar.pendingGeometryChunks};});
 await step(2);await capture('box-fourframes');
 await step(100);await capture('box-settled');
 await aim(placed.width+.012,1.4);const neighbor=await page.evaluate(()=>window.__wireTheHouse.boxFitPreview.telemetry);await capture('neighbor');await hold(true);await step(1);await hold(false);await step(100);
 const count=await page.evaluate(()=>window.__wireTheHouse.mission.points.filter(p=>p.boxGroup.visible).length);
 await aim(.02,1.457);const crowded=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.boxFitPreview,a=p.outlines.geometry.getAttribute('position');return{...p.telemetry,outlineFrontZ:Math.max(...Array.from({length:p.outlines.geometry.drawRange.count},(_,i)=>a.getZ(i))),status:document.querySelector('#box-fit-status').textContent};});await capture('crowded');
 if(!mobile){
  await tool('hammer','Digit4');await page.evaluate(async()=>{const g=window.__wireTheHouse,v=g.room.brickWall.volume,f=v.frontZ;for(let pass=0;pass<3;pass++)for(let x=-1.17;x<=-.8299;x+=.034)for(let y=1.25;y<=1.4501;y+=.04){const h=v.raycast({x,y,z:f+.1},{x:0,y:0,z:-1},.3);if(h&&f-h.point.z<.07)g.chasing.spawnDebris(v.impact({point:h.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:5}));g.chasing.update(1/60);}g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();});await aim(-1,1.35);await step(1200);await capture('debris');
 }
 report.cases.push({mobile,rearm,impact,fit,placed,neighbor,crowded,count,errors});
 if(!baseline){assert(rearm.holding&&rearm.phase>0,'First held input after cast is discarded');assert(impact.impactFrame>0&&impact.visibleFrame>=impact.impactFrame&&impact.delayFrames<=4,'Native impact stays invisible');assert(fit.canPlace);assert(placed.visible);assert(neighbor.canPlace);assert.equal(count,2);assert.equal(crowded.reason,'other-box');assert(!crowded.canPlace);assert(Math.abs(crowded.outlineFrontZ-(crowded.target.wallFrontZ+crowded.proudDepthMm/1000+.007))<.0011);assert.deepEqual(errors,[]);}
 await page.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report.cases.map(c=>({mobile:c.mobile,rearm:c.rearm.phase,fit:c.fit.reason,neighbor:c.neighbor.reason,crowded:c.crowded.reason,count:c.count}))));
