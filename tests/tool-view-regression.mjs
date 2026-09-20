import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import assert from 'node:assert/strict';
const before=process.argv.includes('--before'),out=`output/tool-view-regression/${before?'before':'after'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
const report={cases:[],errors:[]};
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});await blockPointerLock(context);const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);
  await page.waitForTimeout(1200);await page.evaluate(()=>{const g=window.__wireTheHouse;g.__poseStep=g.step.bind(g);g.step=()=>{};});
  for(const [name,tool,pitch,z,crouch] of [['spray-down','spray',-1.18,-.5,false],['spray-crouch','spray',-1.18,-.5,true],['hammer-down','hammer',-1.1,-.5,false],['laser','laser',-.25,-1.7,false],['hose','hose',-.7,-.5,false],['measure','measure',-.2,-1.75,false],['drill','drill',.1,-.5,false]]){
   const state=await page.evaluate(async({tool,pitch,z,crouch})=>{
    const g=window.__wireTheHouse,c=g.renderer.camera,w=g.workerBody;g.mixing.setActive(false);g.selectTool(tool);g.player.crouched=crouch;g.player.yaw=0;g.player.pitch=pitch;g.player.velocity.set(0,0,0);c.position.set(.7,crouch?.95:1.65,z);c.rotation.set(pitch,0,0);g.player.workPosition.locked=false;g.player.workPosition.released=false;
    for(let i=0;i<65;i++)g.__poseStep(1/60,0,false);
    g.renderer.render();await g.renderer.waitForFrame();
    const meshes=[];w.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();meshes.push({name:o.name,bounds:o.boundingBox.clone().applyMatrix4(o.matrixWorld)});}});
    const obj=g.fpsRig.tools.get(tool),tape=g.fpsRig.getObjectByName('tape-blade-outlet'),pencil=g.fpsRig.getObjectByName('Carpenter pencil in left hand');
    const shown=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return !!o;};
    const hose=g.hoseSupply,p=hose.mesh.geometry.attributes.position;
    const projected=[];obj.traverse(o=>{if(!o.isMesh||!shown(o)||o.userData.workerLimb)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)projected.push(c.position.clone().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).project(c).toArray());});
    return {tool,pitch,crouch,position:c.position.toArray(),worker:w.telemetry,meshes,toolPosition:obj.getWorldPosition(c.position.clone()).toArray(),toolQuaternion:obj.getWorldQuaternion(c.quaternion.clone()).toArray(),projected,grips:g.fpsRig.anatomicalGrips().map(p=>({active:p.active,side:p.side,referenceKey:p.referenceKey,contact:p.contactLocked})),tape:tape?.getWorldPosition(c.position.clone()).toArray(),pencilVisible:shown(pencil),measurement:g.heightMeasure.telemetry,hose:tool==='hose'?{visible:hose.mesh.visible,connectionError:hose.start.distanceTo(obj.localToWorld(c.position.clone().set(.207,-.181,.026))),minY:Math.min(...Array.from({length:p.count},(_,i)=>p.getY(i)))}:null,overflow:document.documentElement.scrollWidth>innerWidth};
   },{tool,pitch,z,crouch});
   report.cases.push({name,mobile,...state});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});
   assert(!state.overflow);
   if(!before&&tool==='measure'&&state.measurement.target)assert(Math.hypot(...state.tape.map((v,i)=>v-state.measurement.target[i]))<.001,'Casing outlet remains attached to measured tape');
   if(!before&&tool==='hose'){assert(state.hose.visible);assert(state.hose.connectionError<1e-6);assert(state.hose.minY>=-.001,'Supply hose stays above floor');}
   if(!before&&tool==='spray')assert(state.projected.every(p=>Math.abs(p[0])<1.05&&Math.abs(p[1])<1.05),'Spray can stays in view through crouch');
   if(tool==='measure'){
    await page.locator('#measure-mark').click();await page.evaluate(async()=>{const g=window.__wireTheHouse;for(let i=0;i<8;i++)g.__poseStep(1/60,0,false);g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-pencil-stroke.png`});
   }
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log({cases:report.cases.length,errors:report.errors});
