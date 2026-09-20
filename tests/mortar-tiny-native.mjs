import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/',out=process.argv[3]??'output/mortar-tiny-native';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={url,fixture:'Real impact-cut hollow-clay wall, finite prefilled mortar bed. A controlled 48 × 8 mm strip is removed from the bed and accounted as fallen mortar. Native desktop E and mobile USE hold/release must visibly repair this gap without regenerating the bed.',mobileIsEmulation:true,cases:[]};
try{for(const mobile of [false,true]){
 const platform=mobile?'mobile':'desktop';if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==platform)continue;
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 await context.addInitScript(()=>{const old=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=a=>a instanceof Uint32Array&&a.length===1?(a[0]=260913,a):old(a);});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket('**',()=>{});await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,null,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();
 const fixture=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,v=g.room.brickWall.volume,f=v.frontZ,m=g.mortar,V=g.renderer.camera.position.constructor;window.__tinyStep=g.step.bind(g);g.step=()=>{};
  let strikes=0;for(let pass=0;pass<3;pass++)for(let x=-.048;x<=.04801;x+=.024)for(let y=1.364;y<=1.43601;y+=.024){const hit=v.raycast({x,y,z:f+.05},{x:0,y:0,z:-1},.24);if(hit&&f-hit.point.z<.04){v.impact({point:hit.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:5});strikes++;}}
  g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
  for(let i=0;i<12;i++){const held=m.deposit(new V(0,1.4,f-.04),.65,new V(0,0,1),false,.65);m.launchedMass+=.65;m.stuckMass+=held;m.floorMass+=.65-held;for(let frame=0;frame<4;frame++)m.field.tick(.061);}
  const removed=m.field.removeWhere(p=>Math.abs(p.x)<.024&&Math.abs(p.y-1.4)<.0041);m.stuckMass-=removed;m.floorMass+=removed;m.geometryRevision++;await m.waitForGeometry();
  window.__tinyContacts=[];const deposit=m.deposit.bind(m);m.deposit=(p,kg,n,...rest)=>{const held=deposit(p,kg,n,...rest);window.__tinyContacts.push({point:p.toArray(),requestedKg:kg,heldKg:held});return held;};
  return{strikes,removedKg:removed,initialLaunchedKg:m.launchedMass,initialStuckKg:m.stuckMass};
 });
 if(mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.46);c.lookAt(0,1.4,g.room.brickWall.volume.frontZ+.004);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
 const steps=n=>page.evaluate(count=>{for(let i=0;i<count;i++)window.__tinyStep(1/120);},n);
 const read=()=>page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor;let count=0,covered=0;const points=[];for(let x=-.016;x<=.01601;x+=.004){const o=new V(x,1.4,v.frontZ+.03),d=new V(0,0,-1),wall=v.raycast(o,d,.24),hit=m.field.raycast(o,d,.24);count++;const yes=Boolean(hit&&(!wall||hit.point.z>wall.point.z+.001));if(yes)covered++;points.push({x,covered:yes,depth:hit?v.frontZ-hit.point.z:null});}return{covered:covered/count,points,telemetry:m.telemetry,fieldKg:m.field.mass,contacts:window.__tinyContacts,renderError:g.renderer.renderError,pointerLocked:Boolean(document.pointerLockElement)};});
 const capture=async name=>{await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.mortar.waitForGeometry();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${platform}-${name}.png`});};
 await steps(72);const before=await read();await capture('before');assert.equal(before.covered,0,'Fixture did not leave a visible slit');
 const cdp=mobile?await context.newCDPSession(page):null,held=async down=>{if(cdp){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x:b.x+b.width/2,y:b.y+b.height/2,id:29}]:[]});}else await page.keyboard[down?'down':'up']('KeyE');};
 const loads=[];for(let i=0;i<3;i++){await held(true);await steps(56);await held(false);await steps(240);const s=await read();loads.push(s);assert(Math.abs(s.telemetry.launchedKg-fixture.initialLaunchedKg-(i+1)*.65)<1e-7);assert(Math.abs(s.telemetry.launchedKg-s.telemetry.stuckKg-s.telemetry.restingKg-s.telemetry.floorKg-s.telemetry.movingKg)<1e-7);assert(Math.abs(s.fieldKg-s.telemetry.stuckKg)<1e-7);if(s.covered===1)break;}
 await capture('after');const last=loads.at(-1);report.cases.push({platform,fixture,before,loads,errors});assert.equal(last.covered,1,'Native finishing scoop left the small slit unfilled');assert.equal(last.renderError,'');assert.equal(last.pointerLocked,false);assert.deepEqual(errors,[]);console.log(JSON.stringify({platform,fixture,before:before.covered,loads:loads.map(s=>({covered:s.covered,stuckKg:s.telemetry.stuckKg,contacts:s.contacts}))}));await context.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
