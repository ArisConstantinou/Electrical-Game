import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/wheelbarrow';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[],cases:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.routeWebSocket('**',()=>{});
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.cartStep=g.step.bind(g);g.step=()=>{};});
 const step=async(n=2)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.cartStep(1/60);},n);
 const state=()=>page.evaluate(()=>window.__wireTheHouse.mixing.wheelbarrow.telemetry);
 const key=async(code,n=2)=>{await page.keyboard.down(code);await step(n);await page.keyboard.up(code);await step(2);};
 const shot=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});};
 const aim=async(name)=>{
   const found=await page.evaluate(name=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow,c=g.renderer.camera;
     const points=name==='shovel'?[g.mixing.models.shovel.getObjectByName('shovel-dished-steel-blade').getWorldPosition(c.position.clone())]:name==='spill'?w.parcels.filter(p=>p.settled&&p.mass>.05).map(p=>p.position.clone()):[w.model.group.localToWorld(c.position.clone().set(0,.53,0)),...['rubber-hand-grip-1','rubber-hand-grip--1','pressed-yellow-tray'].map(n=>{const o=w.model.group.getObjectByName(n);o.geometry.computeBoundingBox();return o.localToWorld(o.geometry.boundingBox.getCenter(c.position.clone()));})];
     for(const point of points)for(const [x,z] of [[0,-1.7],[-1.7,0],[1.7,0],[0,1.7],[-1.2,-1.2],[1.2,-1.2]]){
       c.position.copy(point).add({x,y:0,z}).setY(1.65);g.player.update(0);c.lookAt(point);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
       for(let n=0;n<3;n++)window.cartStep(1/60);c.lookAt(point);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);for(let n=0;n<3;n++)window.cartStep(1/60);if(g.mixing.aimedObject()?.kind===(name==='spill'?'spill':name==='shovel'?'shovel':'wheelbarrow'))return true;
     }return false;
   },name);assert(found,`Visible ${name} must be reachable`);await step(2);
 };
 await aim('cart');await shot('01-parked');await key('KeyE');assert.equal((await state()).driving,true,'E enters the visible wheelbarrow');await step(80);await page.mouse.down();await step(3);assert.equal((await state()).driving,true,'LMB does not release the cart');await page.mouse.up();await shot('02-gripping');
 const before=await state();await key('KeyW',50);const normal=await state();report.cases.push({name:'normal',before,after:normal});assert(normal.wheelAngle!==before.wheelAngle,'Wheel rolls with real forward displacement');assert.equal(normal.state,'driving');assert(normal.massKg>113.5,'Ordinary movement does not dump the load');await shot('03-normal');
 await key('KeyE');await step(100);assert.equal((await state()).state,'parked');assert(Math.abs((await state()).pitch)<.01);await shot('04-released');
 // Isolate each physical direction in a clear section of the same room.
 for(const direction of ['KeyA','KeyD','KeyW','KeyS','diagonal']){
   await page.evaluate(direction=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow;w.release();w.state='parked';w.pitch=w.roll=w.pitchSpeed=w.rollSpeed=0;w.massKg=114;w.shovelKg=0;w.consumedKg=0;w.parcels.length=0;w.model.group.position.set(direction==='diagonal'?1.2:0,0,direction==='diagonal'?-.8:-.15);w.yaw=0;w.model.group.rotation.set(0,0,0);},direction);
   await aim('cart');await key('KeyE');await page.keyboard.down('ShiftLeft');if(direction==='diagonal'){await page.keyboard.down('KeyW');await key('KeyD',50);await page.keyboard.up('KeyW');}else await key(direction,50);await page.keyboard.up('ShiftLeft');await step(160);
   const flipped=await state();report.cases.push({name:direction,after:flipped,pattern:await page.evaluate(()=>window.__wireTheHouse.mixing.wheelbarrow.parcels.filter(p=>p.mass>0).map(p=>({mass:p.mass,position:p.position.toArray(),scale:p.scale.toArray()})))});await shot(`flip-${direction}`);assert.equal(flipped.state,'flipped',`${direction} fast movement can tip the cart`);assert(Math.abs(flipped.totalKg-114)<1e-6,'Flip conserves all mortar');
   await aim('cart');await key('KeyE');await step(100);report.righting={state:await state(),aim:await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry.aimedTarget)};assert.equal((await state()).state,'parked','E rights the cart');
 }
 await aim('shovel');await key('KeyE');assert.equal(await page.evaluate(()=>window.__wireTheHouse.mixing.tool),'shovel','E picks the real shovel');await aim('spill');await step(2);await key('KeyE');await step(85);const scoop=await state();report.scoop={...scoop,aim:await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry.aimedTarget)};await shot('scoop-check');assert(scoop.shovelKg>0,'E scoops actual settled mortar');await shot('05-recovered-shovel');
 await aim('cart');await key('KeyE');await step(85);const deposit=await state();assert.equal(deposit.shovelKg,0);assert(deposit.massKg>scoop.massKg);assert(Math.abs(deposit.totalKg-114)<1e-6);await shot('06-returned');
 report.capacity=await page.evaluate(()=>{const g=window.__wireTheHouse,w=g.mixing.wheelbarrow,template=w.parcels[0];w.parcels.length=0;for(let i=0;i<240;i++)w.parcels.push({mass:.1,position:template.position.clone().set((i%20)*.02,.01,Math.floor(i/20)*.02),velocity:template.velocity.clone().set(0,0,0),scale:template.scale.clone().set(.025,.007,.025),rotation:template.rotation.clone(),settled:true});w.massKg=90;w.state='flipped';w.pitch=2.45;for(let i=0;i<360;i++)w.update(1/120);return w.telemetry;});assert.equal(report.capacity.massKg,0,'Render capacity cannot trap mortar in a flipped tray');assert(Math.abs(report.capacity.totalKg-114)<1e-6);assert(report.capacity.parcels<=240);
 assert.deepEqual(report.errors,[]);report.passed=true;report.final=deposit;console.log(JSON.stringify(report));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
