import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/drum-mixer-ui';await mkdir(out,{recursive:true});const report={errors:[],cases:[],mobileIsEmulation:true};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});await blockPointerLock(page.context());await page.routeWebSocket('**',()=>{});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://127.0.0.1:5364/Electrical-Game/?renderer=webgl');await page.waitForFunction(()=>window.__wireTheHouse);await page.locator('#start-button')[mobile?'tap':'click']();await page.waitForTimeout(600);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.drumStep=g.step.bind(g);g.step=()=>{};});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.drumStep(1/60);},n);
 const state=()=>page.evaluate(()=>window.__wireTheHouse.mixing.telemetry);
 const shot=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});};
 const aim=async kind=>{await page.evaluate(kind=>{
   const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,root={drum:m.models.concreteMixer,bucket:m.models.bucket,sand:m.models.sand,sack:m.models.sacks[0],mixer:m.models.mixer}[kind];m.models.group.updateMatrixWorld(true);
   const origin=root.getWorldPosition(c.position.clone()),points=[];
   if(kind==='drum')for(const x of [0,.1,-.1])points.push(root.localToWorld(c.position.clone().set(x,1.15,-.42)));
   else if(kind==='sand')for(const x of [.2,.5,0])points.push(origin.clone().add(c.position.clone().set(x,.32,-.25)));
   else root.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();points.push(o.localToWorld(o.geometry.boundingBox.getCenter(c.position.clone())));}});
   for(const dz of [-.75,-1,-1.4])for(const dx of [0,.4,-.4,.7,-.7])for(const height of [1.65,.95])for(const point of points){
    c.position.set(origin.x+dx,height,origin.z+dz);c.lookAt(point);c.updateMatrixWorld(true);
    if(m.aimedObject()?.kind===kind){g.player.crouched=height===.95;g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;return;}
   }throw new Error(`No accessible ${kind}`);
 },kind);await step(2);assert.equal((await state()).aimedTarget,kind);};
 const equip=async tool=>{await page.locator(tool==='hands'?'#mixing-put-down':`[data-mix-equip="${tool}"]`)[mobile?'tap':'click']();await step(2);};
 const cdp=mobile?await page.context().newCDPSession(page):null;
 const interact=async(frames=1)=>{if(mobile){const b=await page.locator('#mobile-interact').boundingBox();assert(b);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:11}]});await step(frames);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await page.keyboard.down('KeyE');await step(frames);await page.keyboard.up('KeyE');}await step(2);};
 await aim('drum');await equip('water');
 for(let i=0;i<4;i++){await aim('drum');await interact();await step(90);assert.equal((await state()).drum.batch.waterLitres,(i+1)*5);}
 assert.equal((await state()).batch.massKg,0);await shot('water');
 await equip('trowel');await aim('sack');await interact();await step(60);
 for(let i=0;i<18;i++){await aim('sack');await interact();await step(100);assert((await state()).batch.heldTrowel);assert(Math.abs((await state()).drum.batch.cementScoops-i)<1e-7);await aim('drum');await interact();await step(65);assert(Math.abs((await state()).drum.batch.cementScoops-i-1)<1e-7);}
 await equip('shovel');for(let i=0;i<36;i++){await aim('sand');await interact();await step(100);assert((await state()).batch.heldShovel);assert(Math.abs((await state()).drum.batch.sandScoops-i)<1e-7);await aim('drum');await interact();await step(65);assert(Math.abs((await state()).drum.batch.sandScoops-i-1)<1e-7);}
 const loaded=await state();assert.equal(loaded.drum.batch.quality,'unmixed');assert.equal(loaded.batch.massKg,0);assert.equal(loaded.wheelbarrow.massKg,114);await aim('drum');await shot('loaded');
 await equip('hands');await aim('drum');await interact();assert.equal((await state()).drum.running,true);const angle=(await state()).drum.angle;await step(30);assert.notEqual((await state()).drum.angle,angle);await shot('turning');
 // Leave it running while adding water in the cordless station. The batches
 // must remain separate; automatic drum operation must survive tool changes.
 await equip('water');await aim('bucket');await interact();await step(90);let simultaneous=await state();assert.equal(simultaneous.drum.running,true);assert(Math.abs(simultaneous.batch.waterLitres-20/3)<1e-8);assert.equal(simultaneous.drum.batch.waterLitres,20);
 await equip('mixer');await aim('bucket');await interact();await step(60);assert.equal((await state()).inserted,true);await aim('bucket');await interact(60);assert.equal((await state()).drum.running,true);
 await equip('hands');await aim('drum');await step(500);assert.equal((await state()).drum.batch.ready,true);await interact();assert.equal((await state()).drum.running,false);const ready=await state();assert.equal(ready.drum.batch.quality,'balanced');await shot('ready');
 await page.locator('#mixing-finish')[mobile?'tap':'click']();await step(3);
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.2,1.65,-1.55);c.lookAt(.2,1.3,-2.41);g.player.crouched=false;g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await step(5);
 if(mobile){const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:12}]});await step(28);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await step(110);}else{await page.keyboard.down('KeyE');await step(28);await page.keyboard.up('KeyE');await step(110);}
 const cast=await state();assert(Math.abs(ready.drum.batch.massKg-cast.drum.batch.massKg-.65)<1e-7);assert.equal(cast.wheelbarrow.massKg,114);assert.equal(cast.batch.waterLitres,simultaneous.batch.waterLitres);await shot('drum-mortar-wall');
 report.cases.push({mobile,loaded,simultaneous,ready,cast});await page.close();
}assert.deepEqual(report.errors,[]);}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:true,platforms:report.cases.map(s=>s.mobile?'touch':'desktop')}));
