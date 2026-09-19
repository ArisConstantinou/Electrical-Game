import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/',out=process.argv[3]??'output/cast-then-box-native';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 const page=await context.newPage(),errors=[];await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.roomWater.waterProActive,null,{timeout:120000});await page.locator('#start-button')[mobile?'tap':'click']();
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.__castBoxStep=g.step.bind(g);g.step=()=>{};});await prepareFinishedMortar(page);
 const steps=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__castBoxStep(1/60);},n);
 const cdp=mobile?await context.newCDPSession(page):null;
 const press=async(down)=>{if(cdp){if(down){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:31}]});}else await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else await page.keyboard[down?'down':'up']('KeyE');};
 const aim=async(x,distance)=>{await page.evaluate(({x,distance})=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);g.player.workPosition.locked=false;g.player.workPosition.released=true;c.position.set(x,g.player.eyeHeight,g.room.brickWall.volume.frontZ+distance);c.lookAt(x,1.45,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},{x,distance});await steps(12);};
 const tool=async(name,key)=>{if(mobile)await page.locator(`[data-tool="${name}"]`).tap();else await page.keyboard.press(key);await steps(3);};
 await tool('trowel','Digit7');
 for(const x of [.59,.70,.81]){await aim(x,.85);await press(true);await steps(28);await press(false);await steps(150);}
 await page.evaluate(async()=>{await window.__wireTheHouse.mortar.waitForGeometry();});
 const mass=await page.evaluate(()=>window.__wireTheHouse.mortar.telemetry);assert(mass.stuckKg>mass.launchedKg-1e-5,'Repeated PERFECT casts around the box bed must remain on the wall');assert(mass.floorKg<1e-5,'Repeated PERFECT casts still create visible floor waste');
 await tool('fitting','Digit5');const cases=[];
 for(const preset of ['1G','2G','2G+1G']){
  await page.locator(`[data-box-preset="${preset}"]`)[mobile?'tap':'click']();await steps(3);await aim(.70,1.2);
  const distant=await page.evaluate(()=>window.__wireTheHouse.boxFitPreview.telemetry);await press(true);await press(false);await steps(3);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.mission.points.filter(p=>p.boxGroup.visible).length),0,'Distant wall is beyond physical box placement reach');
  const refusal=await page.evaluate(()=>window.__wireTheHouse.hud.prompt.textContent);assert.match(refusal,/Πλησίασε/);
  await aim(.70,.48);
  const boundary=await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera.clone(),V=c.position.constructor,front=g.room.brickWall.volume.frontZ,depth=g.boxFitPreview.assessment.proudDepthM;
   for(let d=.48;d<1.15;d+=.002){c.position.z=front+d;c.lookAt(.7,1.45,front);c.updateMatrixWorld(true);const wall=new V(.7,1.45,front),face=new V(.7,1.45,front+depth);if(!g.fpsRig.canReachPoint(c,wall)&&g.fpsRig.canReachPoint(c,face))return d;}return null;});
  assert(boundary!==null,'A physically reachable proud rim extends the placement boundary');await aim(.70,boundary);
  const before=await page.evaluate(()=>window.__wireTheHouse.boxFitPreview.telemetry);assert(before.canPlace);assert.equal(before.mode,'proud');
  await press(true);await press(false);await steps(120);
  const after=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points.find(p=>p.boxGroup.visible);return{visible:!!p,placement:p?.boxGroup.userData.placement,depth:p?.boxGroup.position.z,removed:g.room.brickWall.volume.removedNodeCount,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert(after.visible);assert(after.depth>.04);assert.equal(after.placement.state,'bonded');assert.equal(after.removed,0);assert(!after.overflow);
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${preset.replace('+','-')}.png`});
  cases.push({preset,distant,refusal,boundary,before,after});await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points.find(p=>p.boxGroup.visible);g.boxPlacement.retrieve(p);});await steps(3);
 }
 assert.deepEqual(errors,[]);report.push({mobile,mass,cases,errors});await context.close();
}}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify({url,mobileIsEmulation:true,report},null,2));}
console.log(JSON.stringify(report));
