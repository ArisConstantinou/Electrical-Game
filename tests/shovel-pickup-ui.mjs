import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/shovel-pickup';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report=[];
try{for(const mobile of [false,true]){
const context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse?.mixing);await page.locator('#start-button').click();await page.waitForTimeout(900);
const pose=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera;window.__pickupStep=g.step.bind(g);g.step=()=>{};m.chooseTool('trowel');m.models.group.updateMatrixWorld(true);const origin=m.models.group.getWorldPosition(c.position.clone());const blade=m.models.shovel.localToWorld(c.position.clone().set(0,.12,.022));
const roots=[m.models.bucket,m.models.sand,...m.models.sacks,m.models.rinse,m.models.water,m.models.mixer,m.models.shovel,m.stationTrowel].filter(o=>o.visible);
const belongs=(o,r)=>{while(o){if(o===r)return true;o=o.parent;}return false;};
for(const dx of [0,-.4,.4,-.8,.8])for(const dz of [-1,-1.5,-.6])for(const ox of [.12,-.12,.16,-.16]){c.position.set(origin.x+dx,1.65,origin.z+dz);c.lookAt(blade.clone().add({x:ox,y:0,z:0}));c.updateMatrixWorld(true);m.ray.setFromCamera({x:0,y:0},c);const hit=m.ray.intersectObjects(roots,true)[0];if(hit&&belongs(hit.object,m.models.sand)&&m.aimedObject()?.kind==='shovel'){g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;return {camera:c.position.toArray(),rotation:c.rotation.toArray(),raw:hit.object.name,selected:m.aimedObject().kind};}}
throw Error('No sand near-miss acquired');});
await page.evaluate(()=>{for(let i=0;i<2;i++)window.__pickupStep(1/60);});
await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-prompt.png`});
assert.match(await page.locator('#mixing-world-prompt').textContent(),/ΠΙΑΣΕ ΦΤΥΑΡΙ/);
if(mobile)await page.locator('#mobile-interact').tap();else await page.keyboard.press('KeyE');
await page.evaluate(()=>{for(let i=0;i<3;i++)window.__pickupStep(1/60);});
assert.equal(await page.evaluate(()=>window.__wireTheHouse.mixing.tool),'shovel');
const checks=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera;m.chooseTool('trowel');m.models.group.updateMatrixWorld(true);const roots=[m.models.bucket,m.models.sand,...m.models.sacks,m.models.rinse,m.models.water,m.models.mixer,m.models.shovel,m.stationTrowel].filter(o=>o.visible);const blade=m.models.shovel.localToWorld(c.position.clone().set(0,.12,.022));
// Insert an actual opaque room mesh between camera and shovel; forgiveness must not see through it.
const blocker=g.room.children.find(o=>o.name==='Rough unfinished concrete floor').clone();blocker.geometry=blocker.geometry.clone();blocker.scale.set(.04,12,.04);blocker.position.copy(c.position).lerp(blade,.55);g.room.add(blocker);g.room.updateMatrixWorld(true);m.ray.setFromCamera({x:0,y:0},c);const blocked=m.nearbyVisibleShovel(roots);g.room.remove(blocker);blocker.geometry.dispose();
const sand=m.models.sand.getWorldPosition(c.position.clone());sand.x+=.35;sand.y+=.15;c.lookAt(sand);c.updateMatrixWorld(true);const away=m.aimedObject()?.kind;return {blocked:blocked?.kind??null,away};});assert.equal(checks.blocked,null);assert.equal(checks.away,'sand');report.push({mobile,pose,checks});await context.close();}}
finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));

