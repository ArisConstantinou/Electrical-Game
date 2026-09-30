import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const templates=JSON.parse(await readFile(new URL('../src/player/hammerGripPoses.json',import.meta.url),'utf8'));
const baseline=process.env.QA_ARM_BASELINE==='1',out=process.env.QA_ARM_OUT??'output/arm-motion/after';await mkdir(out,{recursive:true});
const server=await chromium.launchServer({channel:'chrome',headless:true}),browser=await chromium.connect(server.wsEndpoint());
const report={baseline,cases:[],errors:[],failures:[]};
try{
 for(const mobile of [false,true]){
  if(baseline&&mobile)continue;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1600,height:772},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);if(!baseline)await routeBuildingDist(context);
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
  await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
  await p.locator('#apprentice-count').selectOption('0');await p.locator('#start-button').click();await p.keyboard.press('Digit4');
  await p.evaluate(templates=>{window.qaGripPoses=templates;const g=window.__wireTheHouse;window.qaArmStep=g.step.bind(g);g.step=()=>{};},templates);
  for(const setup of [
   {name:'close-15',distance:.65,tilt:15,from:-1.15,to:-.25},
   {name:'close-45',distance:.65,tilt:45,from:-1.15,to:.65},
   {name:'far-45',distance:1.08,tilt:45,from:-1.15,to:1.15},
   {name:'left-45',distance:.65,tilt:45,left:true,from:-1.15,to:.65},
   {name:'crouch',distance:.85,tilt:45,crouch:true,from:-1.15,to:.65},
   {name:'side-55',distance:.85,tilt:55,yaw:true,from:-.55,to:-.55},
  ]){
   if(process.env.QA_ARM_MATCH&&!new RegExp(process.env.QA_ARM_MATCH).test(setup.name))continue;
   await p.evaluate(setup=>{const g=window.__wireTheHouse,c=g.player.camera;g.input.actionHeld=false;g.player.crouched=!!setup.crouch;g.player.velocity.set(0,0,0);g.hammerAutoSide=false;g.fpsRig.hammerHandedness=setup.left?'left':'right';g.room.brickWall.chiselTiltDegrees=setup.tilt;g.room.brickWall.chiselSideDegrees=setup.left?15:-15;g.room.brickWall.chiselEdgeAngle=0;c.position.set(0,setup.crouch?.95:1.65,g.room.brickWall.volume.frontZ+setup.distance);g.player.yaw=setup.yaw?-.6:0;g.player.pitch=setup.from;g.player.workPosition.locked=true;g.player.workPosition.released=false;g.player.workPosition.targetDistanceM=setup.distance;for(let i=0;i<60;i++)window.qaArmStep(1/60,1/60,false);window.qaArmPrevious=null;},setup);
   const item={name:`${mobile?'mobile':'desktop'}-${setup.name}`,setup,frames:[],maxUpper:0,maxJump:0,maxCpu:0,occluded:0};let worst=0;
   for(let batch=0;batch<20;batch++){
    const frames=await p.evaluate(async({setup,batch})=>{
     const g=window.__wireTheHouse,c=g.player.camera,b=g.workerBody,arm=b.firstPersonArms,V=c.position.constructor,frames=[];
     for(let i=0;i<9;i++){
      const frame=batch*9+i,t=frame/179;g.player.pitch=setup.from+(setup.to-setup.from)*t;if(setup.yaw)g.player.yaw=-.6+1.2*t;
      const start=performance.now();window.qaArmStep(1/60,1/60,false);const cpu=performance.now()-start;
      const joints=['L','R'].map(side=>{const upper=arm.bone('upper_arm.'+side),fore=arm.bone('forearm.'+side),hand=arm.bone('hand.'+side),s=upper.getWorldPosition(new V()),e=fore.getWorldPosition(new V());return {side,length:s.distanceTo(e),shoulder:c.worldToLocal(s.clone()).toArray(),elbow:c.worldToLocal(e.clone()).toArray(),foreLength:e.distanceTo(hand.getWorldPosition(new V())),upperRest:b.lengths.get('upper_arm.'+side),foreRest:b.lengths.get('forearm.'+side),handError:(()=>{const grip=g.fpsRig.anatomicalGrips().find(g=>g.side===(side==='R'?1:-1)),rear=window.qaGripPoses[side+'_rear'],aux=window.qaGripPoses[side+'_auxiliary'],expected=new V().fromArray(aux.wrist).lerp(new V().fromArray(rear.wrist),grip.hammerRearWeight??(side==='R'?1:0)),actual=hand.getWorldPosition(new V()).sub(grip.center).applyQuaternion(grip.rotation.clone().invert());return Math.hypot(actual.y-expected.y,Math.hypot(actual.x,actual.z)-Math.hypot(expected.x,expected.z));})()};});
      for(const joint of joints){
       const upper=arm.bone('upper_arm.'+joint.side),fore=arm.bone('forearm.'+joint.side),hand=arm.bone('hand.'+joint.side),Q=c.quaternion.constructor,y=new V(0,1,0);
       const rest=b.rest.get(b.bone('forearm.'+joint.side)),e=fore.getWorldPosition(new V()),u=e.clone().sub(upper.getWorldPosition(new V())).normalize(),f=hand.getWorldPosition(new V()).sub(e).normalize();
       const uq=upper.getWorldQuaternion(new Q()).normalize(),fq=fore.getWorldQuaternion(new Q()).normalize(),neutral=uq.clone().multiply(rest.q);
       neutral.premultiply(new Q().setFromUnitVectors(y.clone().applyQuaternion(neutral).normalize(),f));
       joint.bindGap=rest.p.clone().applyMatrix4(upper.matrixWorld).distanceTo(e);
       joint.hinge=y.clone().cross(y.clone().applyQuaternion(rest.q)).normalize().applyQuaternion(uq).angleTo(u.clone().cross(f));
       joint.twist=neutral.normalize().angleTo(fq);
       joint.wrist=fq.clone().multiply(b.rest.get(b.bone('hand.'+joint.side)).q).angleTo(hand.getWorldQuaternion(new Q()).normalize());
      }
      let jump=0;if(window.qaArmPrevious)for(let j=0;j<2;j++)jump=Math.max(jump,new V().fromArray(joints[j].shoulder).distanceTo(new V().fromArray(window.qaArmPrevious[j].shoulder)));window.qaArmPrevious=joints;
      const hits=[],hiddenHits=[];if(i===8){
       arm.traverse(o=>{if(o.isSkinnedMesh){o.computeBoundingBox();o.computeBoundingSphere();}});
       for(const [x,y] of [[0,0],[-.08,0],[.08,0],[0,-.08],[0,.08]]){
        g.mortar.ray.setFromCamera({x,y},c);
        const hit=g.mortar.ray.intersectObject(arm,true).find(h=>{for(let o=h.object;o;o=o.parent)if(!o.visible)return false;const m=Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material,col=h.object.geometry.attributes.color,f=h.face,v=h.barycoord;return m.colorWrite&&(!col||!v||col.getW(f.a)*v.x+col.getW(f.b)*v.y+col.getW(f.c)*v.z>=m.alphaTest);});
        if(hit){
         // The imported hammer writes depth. A glove behind its housing is
         // not visible, even though a ray restricted to the arms finds it.
         const toolHits=[];g.fpsRig.tools.get('hammer').traverse(mesh=>{
          if(!mesh.isMesh)return;for(let o=mesh;o;o=o.parent)if(!o.visible)return;
          // Visible static batches disable gameplay picking. Invoke the mesh
          // intersection directly for this visibility diagnostic only.
          Object.getPrototypeOf(mesh).raycast.call(mesh,g.mortar.ray,toolHits);
         });
         const cover=toolHits.sort((a,b)=>a.distance-b.distance).find(h=>{const m=Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material;return m.colorWrite&&m.depthWrite&&m.opacity===1;});
         const gripDistance=Math.min(...g.fpsRig.anatomicalGrips().map(grip=>grip.center.distanceTo(hit.point)));
         const ids=hit.object.geometry.attributes.skinIndex,weights=hit.object.geometry.attributes.skinWeight;
         let upperInfluence=0;for(const [vertex,factor] of [[hit.face.a,hit.barycoord.x],[hit.face.b,hit.barycoord.y],[hit.face.c,hit.barycoord.z]])for(let slot=0;slot<4;slot++){
          if(/^(upper_arm|clavicle|spine)/.test(hit.object.skeleton.bones[ids.getComponent(vertex,slot)].name))upperInfluence+=weights.getComponent(vertex,slot)*factor;
         }
         (cover&&cover.distance<hit.distance?hiddenHits:hits).push({x,y,material:hit.object.material.name,distance:hit.distance,cover:cover?.distance,gripDistance,upperInfluence});
        }
       }
      }
      frames.push({frame,pitch:g.player.pitch,joints,jump,hits,hiddenHits,cpu,status:g.fpsRig.contactStatus});
     }
     await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();return frames;
    },{setup,batch});
    item.frames.push(...frames);const last=frames.at(-1),score=Math.max(...last.joints.map(j=>j.length))+(last.hits.length?2:0);
    if(score>worst){worst=score;await p.screenshot({path:`${out}/${item.name}-worst.png`});}
    if(setup.name==='close-15'&&last.frame===71)await p.screenshot({path:`${out}/${item.name}-frame-71.png`});
   }
   item.maxUpper=Math.max(...item.frames.flatMap(f=>f.joints.map(j=>j.length)));item.maxJump=Math.max(...item.frames.map(f=>f.jump));item.maxCpu=Math.max(...item.frames.map(f=>f.cpu));item.aimIntersections=item.frames.filter(f=>f.hits.length).length;
   // Looking directly at a handle also shows its gripping hand. Keep those
   // intersections in the report. The body must not cross the eye or put
   // its sleeve/upper arm in the aiming region; anatomical and contact
   // assertions separately reject stretched, twisted or detached lower arms.
   item.occluded=item.frames.filter(f=>f.hits.some(h=>h.distance<.12||h.upperInfluence>.05||/cotton|collar/i.test(h.material))).length;
   report.cases.push(item);for(const [bad,message] of [[item.frames.some(f=>f.joints.some(j=>Math.abs(j.length-j.upperRest)>.0005||Math.abs(j.foreLength-j.foreRest)>.0005)),'arm length changed'],[item.frames.some(f=>f.joints.some(j=>j.bindGap>.0005||Math.max(j.hinge,j.twist,j.wrist)>Math.PI/180)),'joint deformed'],[item.occluded>0,'body in reticle'],[item.maxJump>.15,'shoulder discontinuity'],[item.frames.some(f=>f.joints.some(j=>j.handError>1e-6)),'grip moved']])if(bad)report.failures.push(`${item.name}: ${message}`);
   console.log(JSON.stringify({name:item.name,maxUpper:item.maxUpper,maxJump:item.maxJump,occluded:item.occluded}));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  }
  await context.close();
 }
}finally{await browser.close();await server.close();report.browserExitCode=server.process().exitCode;await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));assert.deepEqual(report.errors,[]);if(baseline)assert(report.failures.length,'Baseline did not reproduce');else assert.deepEqual(report.failures,[]);
