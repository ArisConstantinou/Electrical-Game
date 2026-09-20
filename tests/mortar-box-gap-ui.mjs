import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/',out='output/mortar-box-gaps';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={url,fixture:'Seeded impact-cut hollow clay, visible 2G box, native finite-batch casts at fixed perimeter targets. Camera and box placement are test fixtures.',cases:[]};
try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(page.context());
 await page.addInitScript(()=>{const old=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=a=>a instanceof Uint32Array&&a.length===1?(a[0]=260913,a):old(a);});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.routeWebSocket('**',()=>{});await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);await page.locator('#start-button')[mobile?'tap':'click']();
 await page.evaluate(async()=>{
  const g=window.__wireTheHouse,v=g.room.brickWall.volume,f=v.frontZ;window.__gapStep=g.step.bind(g);g.step=()=>{};
  for(let pass=0;pass<4;pass++)for(let x=.42;x<=.6801;x+=.026)for(let y=1.30;y<=1.5001;y+=.025){const h=v.raycast({x,y,z:f+.05},{x:0,y:0,z:-1},.24);if(h&&f-h.point.z<.065)v.impact({point:h.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:6});}
  g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();
  const p=new g.mission.points[0].constructor({...g.mission.points[0].definition,id:'qa-gap-box',x:.55,bottom:1.36,boxes:['2G']});p.position.set(.55,1.4,f);p.boxGroup.visible=true;p.stage='fitted';g.renderer.scene.add(p);g.mission.points.push(p);p.updateWorldMatrix(true,true);
  const V=g.renderer.camera.position.constructor;window.__gapColumns=[];
  for(let x=.438;x<=.6621;x+=.016)for(let y=1.32;y<=1.4801;y+=.016){if(g.mortar.insideBox(new V(x,y,f)))continue;const h=v.raycast({x,y,z:f+.02},{x:0,y:0,z:-1},.24);if(h&&f-h.point.z>.016)window.__gapColumns.push({x,y});}
  const c=g.renderer.camera;c.position.set(.55,1.65,f+.75);c.lookAt(.55,1.4,f);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
 });await prepareFinishedMortar(page);
 if(mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');
 const steps=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__gapStep(1/60);},n);
 const capture=async name=>{await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.mortar.waitForGeometry();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});};
 await steps(3);await capture('before');
 const cdp=mobile?await page.context().newCDPSession(page):null;
 const hold=async down=>{if(cdp){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x:b.x+b.width/2,y:b.y+b.height/2,id:39}]:[]});}else await page.keyboard[down?'down':'up']('KeyE');};
 const targets=[[.46,1.47],[.55,1.47],[.64,1.47],[.46,1.33],[.55,1.33],[.64,1.33],[.44,1.4],[.66,1.4]],loads=[];
 // This broad 65+ mm excavation needs more than two perimeter passes of
 // 0.65 kg. Keep the same targets and a finite three-pass material budget.
 for(let i=0;i<24;i++){
  await page.evaluate(([x,y])=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(x,y,g.room.brickWall.volume.frontZ-.04);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},targets[i%targets.length]);await steps(3);await hold(true);await steps(28);await hold(false);await steps(130);
  loads.push(await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,V=g.renderer.camera.position.constructor,f=g.room.brickWall.volume.frontZ;let flush=0;for(const p of window.__gapColumns){const h=m.field.raycast(new V(p.x,p.y,f+.02),new V(0,0,-1),.24);if(h&&f-h.point.z<.012)flush++;}return{...m.telemetry,flush:flush/window.__gapColumns.length,columns:window.__gapColumns.length};}));
 }
 await capture('filled');await steps(900);
 const stability=await page.evaluate(async()=>{const m=window.__wireTheHouse.mortar;await m.waitForGeometry();window.__gapGeometry=m.deposits.map(d=>Array.from(d.mesh.geometry.getAttribute('position').array));return{...m.telemetry,oldClods:m.projectiles.filter(c=>c.age>10).map(c=>({age:c.age,contacts:c.contacts,p:c.mesh.position.toArray()}))};});
 await steps(120);const stable=await page.evaluate(async()=>{const m=window.__wireTheHouse.mortar;await m.waitForGeometry();return JSON.stringify(window.__gapGeometry)===JSON.stringify(m.deposits.map(d=>Array.from(d.mesh.geometry.getAttribute('position').array)));});
 report.cases.push({mobile,loads,stability,stable,errors});
 assert.equal(loads.at(-1).flush,1,'Native casts leave accessible gaps around the box');assert(loads[7].floorKg<.002,'PERFECT casts shed material before the recess is full');assert.equal(stability.oldClods.length,0,'Residue flickers in an endless collision loop');assert(stable,'Resting mortar changes without force');assert.deepEqual(errors,[]);
 await page.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report.cases.map(c=>({mobile:c.mobile,flush:c.loads.at(-1).flush,stable:c.stable,stability:c.stability}))));
