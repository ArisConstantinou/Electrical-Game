import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';
import {prepareFinishedMortar} from './prepared-mortar-fixture.mjs';
const url=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.argv[3]??'output/mortar-stacking-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,fixture:'A broad recess cut by actual MasonryVolume impacts; no box or authored mortar. Camera placements, aim targets, material seed and deterministic clock are fixtures; the close-to-far retreat uses native mobile movement. Every scoop uses native keyboard or touch hold/release. Deposit instrumentation delegates unchanged to the actual method.',scenarios:[],errors:[]};
const steps=(page,count=1,dt=1/60)=>page.evaluate(({count,dt})=>{for(let i=0;i<count;i++)window.__stackStep(dt);},{count,dt});
const state=page=>page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor,front=v.frontZ;let filled=0,total=0,flush=0,columns=0;for(const {x,y,back} of window.__stackColumns){let hit=m.field.raycast(new V(x,y,front+.03),new V(0,0,-1),.24);if(hit&&front-hit.point.z<.012)flush++;columns++;for(let z=back+.004;z<front;z+=.008){total++;filled+=Math.min(1,m.field.sample(new V(x,y,z)));}}const center=m.field.raycast(new V(0,1.4,front+.03),new V(0,0,-1),.24);return{...m.telemetry,fieldMass:m.field.mass,filledFraction:total?filled/total:0,flushFraction:columns?flush/columns:0,centerRemainingDepthMm:center?(front-center.point.z)*1000:null,crosshair:m.contact(g.renderer.camera.position,g.renderer.camera.getWorldDirection(new V()),3)?.point.toArray(),camera:g.renderer.camera.position.toArray(),tip:g.fpsRig.toolTipWorld(g.renderer.camera,'trowel').toArray(),target:m.target.visible?m.target.position.toArray():null,impacts:window.__stackImpacts.slice(),overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError};});
const shot=async(page,label)=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${label}.png`});};
try{for(const distance of [.46,.85])for(const mobile of [false,true]){
 if(process.env.QA_STACK_PLATFORM&&process.env.QA_STACK_PLATFORM!==`${mobile?'mobile':'desktop'}-${distance===.46?'near':'far'}`)continue;
 const name=(mobile?'mobile':'desktop')+'-'+(distance===.46?'near':'far'),page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
 await blockPointerLock(page.context());
 // Seed the actual masonry constructor before its first render/worker mesh.
 await page.addInitScript(()=>{const fill=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=array=>{if(array instanceof Uint32Array&&array.length===1){array[0]=260913;return array;}return fill(array);};});
 page.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);await page.locator('#start-button')[mobile?'tap':'click']();await page.evaluate(()=>{document.exitPointerLock();const g=window.__wireTheHouse;window.__stackStep=g.step.bind(g);g.step=()=>{};});
 const fixture=await page.evaluate(async()=>{const g=window.__wireTheHouse,w=g.room.brickWall,v=w.volume,front=v.frontZ;let hits=0;const before=v.removedNodeCount;for(let pass=0;pass<10;pass++)for(let x=-.15;x<=.15001;x+=.014)for(let y=1.29;y<=1.51001;y+=.014){const hit=v.raycast({x,y,z:front+.08},{x:0,y:0,z:-1},.3);if(hit&&front-hit.point.z<.066){v.impact({point:hit.point,direction:{x:0,y:0,z:-1},chisel:'flat',widthM:.025,energyJ:18});hits++;}}w.flushGeometry();await w.waitForGeometry();window.__stackColumns=[];for(let x=-.144;x<=.14401;x+=.016)for(let y=1.288;y<=1.51201;y+=.016){const h=v.raycast({x,y,z:front+.03},{x:0,y:0,z:-1},.24);if(h&&front-h.point.z>.012)window.__stackColumns.push({x,y,back:h.point.z});}window.__stackImpacts=[];const deposit=g.mortar.deposit.bind(g.mortar);g.mortar.deposit=(p,m,n,...rest)=>{const held=deposit(p,m,n,...rest);if(m>0)window.__stackImpacts.push({point:p.toArray(),normal:n.toArray(),requestedKg:m,heldKg:held});return held;};return{hits,removed:v.removedNodeCount-before,columns:window.__stackColumns.length};});
 assert(fixture.removed>0&&fixture.columns>50,'fixture exposes an actual broad cavity');
 await prepareFinishedMortar(page);
 if(mobile)await page.locator('[data-tool="trowel"]').tap();else await page.keyboard.press('Digit7');
 await page.evaluate(distance=>{window.__stackDistance=distance;const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+Number(window.__stackDistance));c.lookAt(0,1.4,g.room.brickWall.volume.frontZ-.07);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},distance);await steps(page,60);
 const before=await state(page);await shot(page,`${name}-before`);const loads=[];
 const scenario={platform:name,distance,fixture,before,loads};report.scenarios.push(scenario);
 const cdp=mobile?await page.context().newCDPSession(page):null;
 for(let i=0;i<20;i++){
  if(i>=12){const offsets=[[-.06,-.045],[.06,-.045],[-.06,.045],[.06,.045]],offset=offsets[(i-12)%4];await page.evaluate(([x,y])=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(x,1.4+y,g.room.brickWall.volume.frontZ-.035);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},offset);await steps(page,12);}
  if(cdp){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:17}]});}else await page.keyboard.down('KeyE');
  await steps(page,28);const charged=await state(page);assert(charged.power>=.42&&charged.power<=.58,`${name}: useful native charge`);
  if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyE');
  await steps(page,100);const after=await state(page);assert(Math.abs(after.launchedKg-(i+1)*.65)<1e-7,'exactly one finite scoop per release');assert(Math.abs(after.launchedKg-after.stuckKg-after.floorKg-after.restingKg-after.movingKg)<1e-5,'mass is conserved');loads.push({charged:{crosshair:charged.crosshair,camera:charged.camera,tip:charged.tip,target:charged.target,power:charged.power},after});console.log(JSON.stringify({platform:name,load:i+1,fieldMass:after.fieldMass,fill:after.filledFraction,flush:after.flushFraction,target:charged.target,impact:after.impacts[loads.length===1?0:loads.at(-2).after.impacts.length]}));
  if(i===0||i===7||i===11||i===19)await shot(page,`${name}-load-${i+1}`);
 }
 assert.equal(loads.at(-1).after.overflow,false);assert(!loads.at(-1).after.renderError);
 const first=loads[0],repeated=loads[11].after,spread=loads.at(-1).after;
 assert(first.after.impacts.length>0,`${name}: native scoop contacts real masonry`);
 // An oblique trajectory can hit a real internal clay rib before the camera
 // ray reaches the backing. The visible trajectory marker must predict that
 // collision; the regression must not demand shooting through surviving brick.
 assert(Math.hypot(...first.after.impacts[0].point.map((n,i)=>n-first.charged.target[i]))<.015,`${name}: visible target predicts the actual initial mortar impact`);
 assert(Math.hypot(...first.after.impacts[0].point.slice(0,2).map((n,i)=>n-first.charged.crosshair[i]))<.08,`${name}: release reaches the aimed cavity, including the mobile trowel offset`);
 assert(repeated.fieldMass>first.after.fieldMass+1,`${name}: repeated native loads accumulate mortar`);
 assert(repeated.filledFraction>.05,`${name}: repeated loads fill the center, instead of accumulating only at a displaced edge`);
 assert(spread.filledFraction>repeated.filledFraction+.05,`${name}: moving the aim fills the wider cavity`);
 scenario.summary={firstKg:first.after.fieldMass,repeatedKg:repeated.fieldMass,repeatedFill:repeated.filledFraction,finalKg:spread.fieldMass,finalFill:spread.filledFraction,remainingDepthMm:spread.centerRemainingDepthMm};
 if(mobile&&distance===.46){
  const groove=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor;return window.__stackColumns.filter(p=>Math.abs(p.x)<.08&&Math.abs(p.y-1.4)<.065).map(p=>{const hit=m.field.raycast(new V(p.x,p.y,v.frontZ+.03),new V(0,0,-1),.24);return{...p,z:hit?.point.z??p.back,depthMm:(v.frontZ-(hit?.point.z??p.back))*1000};}).sort((a,b)=>b.depthMm-a.depthMm)[0];});
  scenario.groove={target:groove,loads:[]};
  // A standing close view can hide the lower backing behind the filled upper
  // lip. Change the fixture viewpoint to expose it; all collisions stay real.
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.yaw=0;g.renderer.camera.rotation.y=0;});
  const movePad=await page.locator('#joystick').boundingBox(),moveTouch={x:movePad.x+movePad.width/2,y:movePad.y+movePad.height/2,id:18};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[moveTouch]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...moveTouch,y:movePad.y+movePad.height-5}]});
  await page.evaluate(()=>{const g=window.__wireTheHouse;for(let i=0;i<200&&g.renderer.camera.position.z<g.room.brickWall.volume.frontZ+1.25;i++)window.__stackStep(1/60);});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.evaluate(({x,y})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(x,y,g.room.brickWall.volume.frontZ+.004);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},groove);await steps(page,12);await shot(page,`${name}-groove-before`);
  for(let j=0;j<12;j++){
   const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:17}]});await steps(page,28);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await steps(page,100);
   const after=await state(page),depth=await page.evaluate(({x,y})=>{const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor,h=m.field.raycast(new V(x,y,v.frontZ+.03),new V(0,0,-1),.24);return h?(v.frontZ-h.point.z)*1000:null;},groove);scenario.groove.loads.push({depth,after});console.log(JSON.stringify({platform:name,grooveLoad:j+1,depth,fieldMass:after.fieldMass,filled:after.filledFraction,flush:after.flushFraction}));if(depth!==null&&depth<12)break;
  }
  await shot(page,`${name}-groove-after`);
  const grooveEnd=scenario.groove.loads.at(-1).depth;
  assert(grooveEnd!==null&&grooveEnd<12,`${name}: the exposed deep groove fills to the wall face instead of permanently rejecting every later scoop`);
  scenario.completion=[];
  for(let j=0;j<100&&(await state(page)).flushFraction<1;j++){
   const target=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mortar,v=g.room.brickWall.volume,V=g.renderer.camera.position.constructor;return window.__stackColumns.map(p=>{const h=m.field.raycast(new V(p.x,p.y,v.frontZ+.03),new V(0,0,-1),.24);return{...p,depth:v.frontZ-(h?.point.z??p.back)};}).sort((a,b)=>b.depth-a.depth)[0];});
   await page.evaluate(({x,y})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(x,y,g.room.brickWall.volume.frontZ+.004);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},target);await steps(page,12);
   const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:17}]});await steps(page,28);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await steps(page,100);
   const after=await state(page);scenario.completion.push({target,after});if(j%4===0)console.log(JSON.stringify({platform:name,completionLoad:j+1,filled:after.filledFraction,flush:after.flushFraction,fieldMass:after.fieldMass}));
  }
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.55);c.lookAt(0,1.4,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await steps(page,12);
  await shot(page,`${name}-completed-cavity`);const completed=await state(page);scenario.completed=completed;
  assert.equal(completed.flushFraction,1,'native targeting fills every sampled exposed cavity column to the wall face');
  assert(Math.abs(completed.launchedKg-completed.stuckKg-completed.floorKg-completed.restingKg-completed.movingKg)<1e-5,'full-cavity native sequence preserves every scoop of mortar');
 }
 await page.close();
}}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
assert.deepEqual(report.errors,[]);console.log(JSON.stringify({report:`${out}/report.json`,platforms:report.scenarios.map(s=>s.platform)}));
