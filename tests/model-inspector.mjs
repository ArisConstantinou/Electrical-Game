import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const gpu=process.argv.includes('--webgpu');const out='output/model-inspector'+(gpu?'/webgpu':'');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={errors:[],checks:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/'+(gpu?'':'?renderer=webgl'));await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});
 await page.locator('#start-button').click();await page.waitForTimeout(500);
 await page.keyboard.press('c');await page.waitForTimeout(400);
 assert(await page.evaluate(()=>window.__wireTheHouse.frontBodyView));await page.screenshot({path:`${out}/front-body.png`});await page.keyboard.press('c');
 await page.locator('#model-inspector-open').click();await page.waitForFunction(()=>window.__wireTheHouse.modelInspector.telemetry.loaded);await page.waitForTimeout(700);
 await page.screenshot({path:`${out}/character.png`});report.checks.push(await page.evaluate(()=>window.__wireTheHouse.modelInspector.telemetry));
 await page.selectOption('#model-stance','left');await page.waitForTimeout(400);await page.screenshot({path:`${out}/strafe.png`});
 await page.locator('#model-play').click();const t=await page.evaluate(()=>window.__wireTheHouse.modelInspector.elapsed);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__wireTheHouse.modelInspector.elapsed),t);await page.locator('#model-play').click();
 await page.locator('#model-assets').click();await page.fill('#model-search','drill');report.checks.push({drillResults:await page.locator('#model-count').textContent()});
 await page.locator('#model-list button').first().click();assert.notEqual(await page.evaluate(()=>window.__wireTheHouse.modelInspector.selected),'character');await page.waitForTimeout(300);await page.screenshot({path:`${out}/asset.png`});
 await page.locator('#model-character').click();await page.locator('#model-live').click();await page.waitForTimeout(300);
 const before=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.toJSON?.() ?? {x:window.__wireTheHouse.renderer.camera.position.x,z:window.__wireTheHouse.renderer.camera.position.z});await page.keyboard.down('a');await page.waitForTimeout(400);await page.keyboard.up('a');const after=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.toJSON?.() ?? {x:window.__wireTheHouse.renderer.camera.position.x,z:window.__wireTheHouse.renderer.camera.position.z});assert(Math.hypot(after.x-before.x,after.z-before.z)>.05);report.checks.push({movement:{before,after}});
 await page.screenshot({path:`${out}/live.png`});await page.locator('#model-crouch').click();await page.waitForTimeout(400);assert(await page.evaluate(()=>window.__wireTheHouse.player.crouched));await page.screenshot({path:`${out}/live-crouch.png`});
 await page.selectOption('#model-live-tool','spray');await page.locator('#model-orbit').focus();await page.keyboard.down('Space');await page.waitForTimeout(100);assert(await page.evaluate(()=>window.__wireTheHouse.input.actionHeld));await page.keyboard.up('Space');await page.waitForTimeout(100);assert(!await page.evaluate(()=>window.__wireTheHouse.input.actionHeld));
 // Orbit and USE remain independent of logical tool aim and movement.
 const yaw=await page.evaluate(()=>window.__wireTheHouse.player.yaw);await page.keyboard.down('Space');await page.mouse.move(820,390);await page.mouse.down();await page.mouse.move(910,420,{steps:8});await page.mouse.up();await page.waitForTimeout(50);assert(await page.evaluate(()=>window.__wireTheHouse.input.actionHeld));assert.equal(await page.evaluate(()=>window.__wireTheHouse.player.yaw),yaw);await page.keyboard.up('Space');
 await page.keyboard.down('Alt');await page.mouse.move(820,390);await page.mouse.down();await page.mouse.move(850,400,{steps:3});await page.mouse.up();await page.keyboard.up('Alt');assert.notEqual(await page.evaluate(()=>window.__wireTheHouse.player.yaw),yaw);
 const options=await page.locator('#model-live-tool option').evaluateAll(os=>os.map(o=>o.value));
 for(const tool of options){await page.selectOption('#model-live-tool',tool);await page.waitForTimeout(90);const s=await page.evaluate(()=>{const g=window.__wireTheHouse;return{tool:g.selectedTool,mixing:g.mixing.tool,active:g.mixing.active,visible:g.workerBody.visible};});assert(s.visible);assert.equal(tool.startsWith('mix:')?s.mixing:s.tool,tool.replace('mix:',''));report.checks.push({tool,...s});}
 // Actual in-world ingredient action, initiated from the panel (not a canned animation).
 await page.selectOption('#model-live-tool','mix:water');
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,b=g.mixing.models.bucket.getWorldPosition(c.position.clone());g.player.crouched=false;c.position.set(b.x,1.65,b.z-.98);c.lookAt(b.x,b.y+.3,b.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);});
 await page.locator('#model-front').click();await page.locator('#model-orbit').focus();await page.keyboard.down('Space');await page.waitForTimeout(2200);await page.keyboard.up('Space');
 const water=await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry);report.checks.push({water});assert(water.batch?.waterLitres>0||water.waterLitres>0,JSON.stringify(water));
 await page.screenshot({path:`${out}/live-water.png`});
 const aim=async kind=>{await page.evaluate(kind=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,root={sack:m.models.sacks[0],sand:m.models.sand,bucket:m.models.bucket}[kind];m.models.group.updateMatrixWorld(true);const origin=root.getWorldPosition(c.position.clone()),points=[];if(kind==='sand')for(const x of [.2,.5,0])points.push(origin.clone().add(c.position.clone().set(x,.32,-.25)));else root.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();points.push(o.localToWorld(o.geometry.boundingBox.getCenter(c.position.clone())));}});for(const dz of [-.75,-1,-1.4])for(const dx of [0,.4,-.4,.7,-.7])for(const height of [1.65,.95])for(const point of points){c.position.set(origin.x+dx,height,origin.z+dz);c.lookAt(point);c.updateMatrixWorld(true);if(m.aimedObject()?.kind===kind){g.player.crouched=height===.95;g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;return;}}throw Error('No accessible '+kind);},kind);await page.waitForTimeout(100);await page.locator('#model-front').click();await page.locator('#model-orbit').focus();};
 const use=async(name,duration=1800)=>{await page.keyboard.down('e');await page.waitForTimeout(300);await page.screenshot({path:`${out}/${name}-during.png`});await page.waitForTimeout(duration-300);await page.keyboard.up('e');await page.waitForTimeout(100);};
 await page.selectOption('#model-live-tool','mix:trowel');await aim('sack');await use('trowel-open',1100);await aim('sack');await use('trowel-scoop');assert((await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry)).batch.cementScoops>0);
 await page.selectOption('#model-live-tool','mix:shovel');await aim('sand');await use('shovel');assert((await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry)).batch.sandScoops>0);
 await page.selectOption('#model-live-tool','mix:mixer');await aim('bucket');await use('mixer-insert',1400);await use('mixer-running',1500);const mixed=await page.evaluate(()=>window.__wireTheHouse.mixing.telemetry);assert(mixed.batch.mixProgress>0);report.checks.push({mixingTools:{cement:mixed.batch.cementScoops,sand:mixed.batch.sandScoops,mixProgress:mixed.batch.mixProgress}});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);await page.screenshot({path:`${out}/phone-live.png`});
 await page.locator('#model-live').click();await page.waitForTimeout(500);await page.screenshot({path:`${out}/phone-character.png`});
 await page.locator('#model-close').click();assert(!await page.evaluate(()=>window.__wireTheHouse.modelInspector.active));
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
