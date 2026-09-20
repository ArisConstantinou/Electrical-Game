import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/wheelbarrow-grip';await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
const report={cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto((process.env.GAME_URL??'http://127.0.0.1:5365/Electrical-Game/')+'?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.gripStep=g.step.bind(g);g.step=()=>{};g.mixing.wheelbarrow.enter();for(let i=0;i<160;i++)window.gripStep(1/60);});
 for(const pitch of [-.6,0,-1.0,.4]){
  const data=await page.evaluate(async pitch=>{const g=window.__wireTheHouse,w=g.workerBody,cart=g.mixing.wheelbarrow;g.player.pitch=pitch;for(let i=0;i<3;i++)window.gripStep(1/60);const data={pitch,gripErrors:w.telemetry.gripReachErrors,points:{},fit:w.telemetry.fingerFit,bends:{},elbows:{},thumbSkin:{},twist:w.telemetry.armTwist};
    for(const side of ['R','L']){const wrist=w.point('hand.'+side);data.bends[side]=w.point('middle.01.'+side).sub(wrist).angleTo(wrist.clone().sub(w.point('forearm.'+side)))*180/Math.PI;
      data.elbows[side]=w.point('upper_arm.'+side).sub(w.point('forearm.'+side)).angleTo(wrist.clone().sub(w.point('forearm.'+side)))*180/Math.PI;
      const grip=cart.anatomicalGrips().find(g=>g.side===(side==='R'?1:-1)),axis=wrist.clone().set(0,1,0).applyQuaternion(grip.rotation);let gap=Infinity;
      for(const sample of w.thumbSurface.get(side)){const v=wrist.clone();sample.mesh.getVertexPosition(sample.index,v);v.applyMatrix4(sample.mesh.matrixWorld).sub(grip.center);const h=v.dot(axis);if(Math.abs(h)<.08){v.addScaledVector(axis,-h);gap=Math.min(gap,v.length()-.022);}}data.thumbSkin[side]=gap;
    }
    for(const side of ['R','L'])for(const name of ['hand','middle.01','index.03','thumb.03','forearm','upper_arm'])data.points[name+'.'+side]=cart.model.group.worldToLocal(w.point(name+'.'+side)).toArray();
    g.renderer.render();await g.renderer.waitForFrame();return data;
  },pitch);report.cases.push(data);await page.screenshot({path:`${out}/pitch-${pitch}.png`});
 }
 for(const side of ['R','L']){
   await page.evaluate(async side=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera.clone(),cart=g.mixing.wheelbarrow.model.group;
     c.position.copy(cart.localToWorld(c.position.clone().set(side==='R'?-.56:.56,.86,-1.12)));c.lookAt(w.point('hand.'+side));for(const m of w.headMaterials){m.colorWrite=true;m.depthWrite=true;}g.renderer.viewCamera=c;g.renderer.render();await g.renderer.waitForFrame();
   },side);await page.screenshot({path:`${out}/close-${side}.png`});
 }
 await page.evaluate(async()=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera.clone(),cart=g.mixing.wheelbarrow.model.group;c.position.copy(cart.localToWorld(c.position.clone().set(-1.05,1.15,-1.55)));c.lookAt(w.point('hand.R').lerp(w.point('upper_arm.R'),.5));for(const m of w.headMaterials){m.colorWrite=true;m.depthWrite=true;}g.renderer.viewCamera=c;g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/whole-arm.png`});
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.viewCamera=null;for(const m of g.workerBody.headMaterials){m.colorWrite=false;m.depthWrite=false;}});
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 for(const c of report.cases)for(const side of ['R','L']){assert(c.elbows[side]>168,`${side}: elbow bends to ${c.elbows[side]} degrees`);assert(c.bends[side]<15,`${side}: wrist folds ${c.bends[side]} degrees`);assert(c.thumbSkin[side]>-.003&&c.thumbSkin[side]<.004,`${side}: thumb skin gap ${c.thumbSkin[side]}m`);assert(c.twist[side].foreDegrees<35,`${side}: excessive forearm twist`);}
 const ref=report.cases[0].points;const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 for(const c of report.cases)for(const name of Object.keys(ref).filter(n=>!n.startsWith('forearm')&&!n.startsWith('upper_arm')))assert(distance(c.points[name],ref[name])<.002,`Camera pitch must not move ${name} on the grip`);
 report.motion=await page.evaluate(()=>{const g=window.__wireTheHouse,w=g.workerBody,cart=g.mixing.wheelbarrow,rows=[];g.player.pitch=-.6;
   for(const key of ['KeyA','KeyD','KeyW','KeyS']){g.input.keys.add(key);for(let i=0;i<25;i++){g.player.yaw+=.001;window.gripStep(1/60);const points={};for(const side of ['R','L'])for(const digit of ['hand','middle.01','index.03','thumb.03'])points[digit+'.'+side]=cart.model.group.worldToLocal(w.point(digit+'.'+side)).toArray();const bends={},elbows={},thumbSkin={},thumbSolvers={};for(const side of ['R','L']){const wrist=w.point('hand.'+side);elbows[side]=w.point('upper_arm.'+side).sub(w.point('forearm.'+side)).angleTo(wrist.clone().sub(w.point('forearm.'+side)))*180/Math.PI;bends[side]=w.point('middle.01.'+side).sub(wrist).angleTo(wrist.clone().sub(w.point('forearm.'+side)))*180/Math.PI;
      const grip=cart.anatomicalGrips().find(g=>g.side===(side==='R'?1:-1)),axis=wrist.clone().set(0,1,0).applyQuaternion(grip.rotation);let gap=Infinity;for(const sample of w.thumbSurface.get(side)){const v=wrist.clone();sample.mesh.getVertexPosition(sample.index,v);v.applyMatrix4(sample.mesh.matrixWorld).sub(grip.center);const h=v.dot(axis);if(Math.abs(h)<.08){v.addScaledVector(axis,-h);gap=Math.min(gap,v.length()-.022);}}thumbSkin[side]=gap;thumbSolvers[side]=w.telemetry.fingerFit['thumb'+side]?.solver??'full';
    }rows.push({key,points,bends,elbows,thumbSkin,thumbSolvers,rootY:w.position.y,feet:[w.point('foot.R').y,w.point('foot.L').y],gripErrors:w.telemetry.gripReachErrors});}g.input.keys.delete(key);}
   return rows;
 });
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 for(const sample of report.motion)for(const side of ['R','L'])assert(sample.gripErrors[side]<.003,`${sample.key}: ${side} detached from moving handle`);
 for(const sample of report.motion)for(const side of ['R','L'])assert(sample.bends[side]<35&&sample.elbows[side]>168,`${sample.key}: ${side} moving wrist bends ${sample.bends[side]}`);
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report.cases.map(c=>({pitch:c.pitch,gripErrors:c.gripErrors,hand:c.points['hand.R'],knuckle:c.points['middle.01.R']}))));
 for(const sample of report.motion)for(const side of ['R','L'])assert(sample.thumbSkin[side]>-.003&&sample.thumbSkin[side]<.004,`${sample.key}: ${side} thumb surface loses contact (${sample.thumbSkin[side]}m)`);
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();}
