import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
import {assertHammerAnatomy} from './hammer-anatomy-assertions.mjs';
const out=process.env.QA_GALLERY_OUT??'output/hammer-pose-gallery';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={method:'Actual game body and tool poses. Simulation is frozen only for an external observer camera; no bones or tool geometry are posed for the capture.',cases:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1280,height:960}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();await page.keyboard.press('Digit4');
 await page.addStyleTag({content:'#fps-counter{visibility:hidden!important}'});
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;await g.renderer.waitForFrame();window.qaStep=g.step.bind(g);g.step=()=>{};});
 async function capture(name,view='outside'){
  const state=await page.evaluate(async({name,view})=>{
   const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor;
   const body=g.workerBody,arms={};
   for(const side of ['L','R']){
    const clavicle=body.bone('clavicle.'+side),upper=body.bone('upper_arm.'+side),fore=body.bone('forearm.'+side),hand=body.bone('hand.'+side),Y=new V(0,1,0);
    const u=body.point('forearm.'+side).sub(body.point('upper_arm.'+side)).normalize(),f=body.point('hand.'+side).sub(body.point('forearm.'+side)).normalize();
    const bindHinge=Y.clone().cross(Y.clone().applyQuaternion(body.rest.get(fore).q)).normalize().applyQuaternion(upper.getWorldQuaternion(c.quaternion.clone()));
    const actualHinge=u.clone().cross(f).normalize();
    arms[side]={clavicleDegrees:clavicle.quaternion.angleTo(body.rest.get(clavicle).q)*180/Math.PI,elbowHingeError:bindHinge.angleTo(actualHinge)*180/Math.PI,elbowFlexion:u.angleTo(f)*180/Math.PI,
      positions:['clavicle.','upper_arm.','forearm.','hand.'].map(n=>body.point(n+side).toArray()),localQuaternions:[clavicle,upper,fore,hand].map(b=>b.quaternion.toArray())};
   }
   const state={name,arms,player:JSON.parse(window.render_game_to_text()).player,pose:g.fpsRig.debugPose(),body:g.workerBody.telemetry,impacts:g.room.brickWall.impactCount,jump:g.player.jumpPose};
   window.qaView={position:c.position.clone(),quaternion:c.quaternion.clone(),fov:c.fov,parent:g.fpsRig.parent};
   const feet=c.position.clone();feet.y=g.player.supportFloorY;
   g.renderer.scene.attach(g.fpsRig);
   if(view==='outside'){c.position.set(20.5,2.15,-15.25);c.lookAt(new V(23,1.10,-12.15));}
   else {c.position.copy(feet).add(new V(view==='side'?-2.1:2.1,1.8,1.8));c.lookAt(feet.clone().add(new V(0,.95,-.4)));}
   c.fov=43;c.updateProjectionMatrix();g.workerBody.headMaterials.forEach(m=>{m.colorWrite=true;m.depthWrite=true;});g.siteOcclusion.restore();
   await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();return state;
  },{name,view});
  await page.screenshot({path:`${out}/${name}.png`});report.cases.push(state);
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,s=window.qaView;c.position.copy(s.position);c.quaternion.copy(s.quaternion);c.fov=s.fov;c.updateProjectionMatrix();c.updateMatrixWorld(true);s.parent.attach(g.fpsRig);g.workerBody.headMaterials.forEach(m=>{m.colorWrite=false;m.depthWrite=false;});});
 }
 async function outside(crouched=false){await page.evaluate(crouched=>{const g=window.__wireTheHouse;g.input.actionHeld=false;g.player.crouched=crouched;g.player.camera.position.set(23,crouched?.95:1.65,-12);g.player.yaw=0;g.player.pitch=-.22;g.player.workPosition.locked=false;g.player.workPosition.released=true;for(let i=0;i<90;i++)window.qaStep(1/60,1/60,false);},crouched);}
 await outside();await capture('01-standing');await outside(true);await capture('02-crouched');
 for(const pose of [{name:'03-breaking-straight',side:0,tilt:0,edge:0,crouch:false},{name:'04-breaking-side',side:45,tilt:15,edge:0,crouch:false},{name:'05-breaking-vertical-chisel',side:0,tilt:30,edge:90,crouch:false},{name:'06-breaking-crouched',side:15,tilt:15,edge:90,crouch:true}]){
  await page.evaluate(p=>{const g=window.__wireTheHouse;g.input.actionHeld=false;g.player.crouched=p.crouch;g.hammerAutoSide=false;g.room.brickWall.chiselSideDegrees=p.side;g.room.brickWall.chiselTiltDegrees=p.tilt;g.room.brickWall.chiselEdgeAngle=p.edge*Math.PI/180;g.player.camera.position.set(0,p.crouch?.95:1.65,g.room.brickWall.volume.frontZ+1.08);g.player.yaw=0;g.player.pitch=p.crouch?-.18:-.35;g.player.workPosition.locked=true;g.player.workPosition.released=false;g.player.workPosition.targetDistanceM=1.08;for(let i=0;i<90;i++)window.qaStep(1/60,1/60,false);window.qaStartImpacts=g.room.brickWall.impactCount;g.input.actionHeld=true;for(let i=0;i<16;i++)window.qaStep(1/60,1/60,false);},pose);
  // A real forward approach takes up the different tool reach at each angle.
  await page.evaluate(()=>{window.__wireTheHouse.input.actionHeld=false;});
  await page.keyboard.down('KeyW');await page.evaluate(()=>{for(let i=0;i<80;i++)window.qaStep(1/60,1/60,false);});await page.keyboard.up('KeyW');
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.qaStartImpacts=g.room.brickWall.impactCount;g.input.actionHeld=true;for(let i=0;i<16;i++)window.qaStep(1/60,1/60,false);});
  await capture(pose.name,pose.side?'side':'wall');
  report.cases.at(-1).newImpacts=await page.evaluate(()=>window.__wireTheHouse.room.brickWall.impactCount-window.qaStartImpacts);
 }
 await outside();await page.keyboard.press('Space');
 for(let i=1;i<=41;i++){
  await page.evaluate(()=>window.qaStep(1/60,1/60,false));
  if([3,21,41].includes(i))await capture(i===3?'07-jump-takeoff':i===21?'08-jump-apex':'09-jump-landing');
 }
 assertHammerAnatomy(report);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.cases.map(c=>({name:c.name,jump:c.jump.phase,newImpacts:c.newImpacts,grips:c.body.gripReachErrors}))));
