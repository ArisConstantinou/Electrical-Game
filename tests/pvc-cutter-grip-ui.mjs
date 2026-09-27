import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const baseline=process.argv.includes('--baseline'),out=process.env.CUTTER_QA_OUTPUT??`output/cutter-grip/${baseline?'before':'after'}`;
const url=process.env.CUTTER_QA_URL??'http://127.0.0.1:5365/Electrical-Game/';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={baseline,url,errors:[],poses:[],controls:[],performance:[],physicalPhone:false};
try{
 for(const mobile of process.argv.includes('--desktop-only')?[false]:[false,true]){
  const context=await browser.newContext({viewport:mobile?(process.argv.includes('--landscape')?{width:844,height:390}:{width:390,height:844}):{width:1627,height:849},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();await page.waitForFunction(()=>window.__wireTheHouse?.started);
  await page.evaluate(async baseline=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.cutterStep=g.step.bind(g);g.step=()=>{};const p=g.pvc;p.bend.angles.fill(90/8,0,8);p.bend.revision++;p.bend.grip=7;p.target=g.mission.points[0];p.cutFrom=0;p.cutS=p.bend.topHeight-(p.target.boxGroup.getWorldPosition(g.renderer.camera.position.clone()).y-p.target.boxGroup.groupHeight/2+.015);p.fitZoomed=baseline;p.transition('fitting');p.setFocus();for(let i=0;i<80;i++)window.cutterStep(1/60);},baseline);
  const step=async n=>{const gap=await page.evaluate(n=>{let gap=Infinity;for(let i=0;i<n;i++){window.cutterStep(1/60);if(window.cutterSkinGap)gap=Math.min(gap,window.cutterSkinGap());}return gap;},n);if(!baseline){report.minimumPathGapM=Math.min(report.minimumPathGapM??Infinity,gap);assert(gap>.002,'Glove must stay clear throughout movement and cutting');}};
  const capture=async name=>{
   const pose=await page.evaluate(()=>{
    const g=window.__wireTheHouse,p=g.pvc,body=g.workerBody,V=g.renderer.camera.position.constructor;
    p.work.updateMatrixWorld(true);const q=p.cutter.getWorldQuaternion(g.renderer.camera.quaternion.clone()),a=p.bend.at(p.cutS-.001),b=p.bend.at(p.cutS+.001);
    const tangent=p.pipe.localToWorld(new V(b.x,b.y,0)).sub(p.pipe.localToWorld(new V(a.x,a.y,0))).normalize(),normal=new V(0,0,1).applyQuaternion(q);
    const tip=p.cutter.localToWorld(new V().fromArray(p.cutter.userData.tipPoint)),cut=p.bend.at(p.cutS),contact=p.pipe.localToWorld(new V(cut.x,cut.y,0));
    const rod=p.cutter.getObjectByName('Moving red moulded handle'),centre=rod.getWorldPosition(new V()),axis=new V(0,1,0).applyQuaternion(rod.getWorldQuaternion(q.clone())),half=rod.geometry.parameters.height/2;
    const end=(digit,side)=>{const name=`${digit}.03.${side}`,bone=body.bone(name);return bone.getWorldPosition(new V()).add(new V(0,body.lengths.get(name),0).applyQuaternion(bone.getWorldQuaternion(q.clone())));};
    const fingers=['index','middle','ring','little'].map(d=>{const point=end(d,'R'),heightM=point.clone().sub(centre).dot(axis),along=Math.max(-half,Math.min(half,heightM)),closest=centre.clone().addScaledVector(axis,along);return {digit:d,gapM:point.distanceTo(closest)-.014,heightM,halfM:half};});
    const lower=p.anatomicalGrips().find(grip=>grip.side<0).center;
    const leftFingers=['index','middle','ring','little'].map(d=>{const point=end(d,'L');let nearest=Infinity;for(let i=0;i<=200;i++){const s=p.cutFrom+i/200*(Math.min(.8,p.bend.mark+.25)-p.cutFrom),at=p.bend.at(s);nearest=Math.min(nearest,point.distanceTo(p.pipe.localToWorld(new V(at.x,at.y,0))));}return{digit:d,gapM:nearest-.01};});
    window.cutterSkinGap=()=>{p.work.updateMatrixWorld(true);let gap=Infinity;const heads=['Corrosion resistant open pipe support and metal core','Replaceable double ground V-shaped cutter blade'].map(name=>p.cutter.getObjectByName(name));const leftBones=new Set(['hand',...['index','middle','ring','little','thumb'].flatMap(d=>[1,2,3].map(j=>d+'.0'+j))].map(name=>body.bone(name+'.L')));body.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;for(let i=0;i<indices.count;i++){let weight=0;for(let j=0;j<4;j++)if(leftBones.has(mesh.skeleton.bones[indices.getComponent(i,j)]))weight+=weights.getComponent(i,j);if(weight<.75)continue;const world=mesh.localToWorld(mesh.getVertexPosition(i,new V()));for(const head of heads){if(!head.geometry.boundingBox)head.geometry.computeBoundingBox();const point=head.worldToLocal(world.clone()),box=head.geometry.boundingBox;gap=Math.min(gap,point.distanceTo(new V().copy(point).clamp(box.min,box.max)));}}});return gap;};
    const leftSkinGapM=window.cutterSkinGap(),hand=body.bone('hand.R'),neutral=new V(0,1,0).applyQuaternion(hand.getWorldQuaternion(q.clone()).multiply(body.handFrames.get('R').foreToHand.clone().invert())),fore=hand.getWorldPosition(new V()).sub(body.bone('forearm.R').getWorldPosition(new V())).normalize();
    return {phase:p.phase,elapsed:p.elapsed,leftSkinGapM,cutterRetreat:p.cutterRetreat??0,cutterReady:p.cutterReady??true,planeAlignment:Math.abs(normal.dot(tangent)),cutAnchorErrorM:tip.distanceTo(contact),fingers,leftFingers,leftCenter:lower.toArray(),supportS:p.supportS??null,cutPoint:contact.toArray(),wristBendDegrees:Math.acos(Math.max(-1,Math.min(1,neutral.dot(fore))))*180/Math.PI,reach:body.telemetry.gripReachErrors,camera:g.renderer.camera.position.toArray(),movingAngle:rod.parent.rotation.z,cutFrom:p.cutFrom,cutS:p.cutS,offcuts:p.offcuts.length};
   });
   pose.mobile=mobile;pose.name=name;report.poses.push(pose);
   await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});return pose;
  };
  if(process.argv.includes('--profile'))report.performance.push({mobile,...await page.evaluate(async()=>{
   const g=window.__wireTheHouse,r=g.renderer,samples=[],intervals=[],draw=r.drawScene.bind(r);let count=0,last,resources;
   r.drawScene=function(scene){draw(scene);resources={calls:r.webgl.info.render.calls,triangles:r.webgl.info.render.triangles,textures:r.webgl.info.memory.textures};};
   g.step=function(...args){const start=performance.now();window.cutterStep(...args);if(count>45)samples.push(performance.now()-start);};
   try{await new Promise(resolve=>{const frame=now=>{if(count>45&&last)intervals.push(now-last);last=now;if(++count<150)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});await r.waitForFrame();}finally{g.step=()=>{};r.drawScene=draw;}
   samples.sort((a,b)=>a-b);intervals.sort((a,b)=>a-b);return{environment:'Windows Chrome with real rendering, 45 warmup and 105 sampled frames; touch is PC emulation',simulationMeanMs:samples.reduce((a,b)=>a+b,0)/samples.length,simulationP95Ms:samples[Math.floor(samples.length*.95)],frameP95Ms:intervals[Math.floor(intervals.length*.95)],frameMaxMs:intervals.at(-1),over50ms:intervals.filter(ms=>ms>50).length,...resources};
  })});
  const ready=await capture('ready');
  let moveHand;
  if(!baseline){
   const camera=ready.camera;moveHand=async(direction,n)=>{
    if(!mobile){await page.keyboard.down(direction<0?'KeyW':'KeyS');await step(n);await page.keyboard.up(direction<0?'KeyW':'KeyS');await step(2);}
    else{const box=await page.locator('#joystick').boundingBox(),cdp=await context.newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+direction*box.height*.45}]});await step(n);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await step(2);await cdp.detach();}
   };
   if(mobile){assert(await page.locator('.pvc-hand-arrows').isVisible());assert.equal(await page.locator('.pvc-hand-arrows').textContent(),'↑↓');const arrows=await page.locator('.pvc-hand-arrows').boundingBox(),thumb=await page.locator('#joystick-thumb').boundingBox();assert(arrows.x>=thumb.x&&arrows.y>=thumb.y&&arrows.x+arrows.width<=thumb.x+thumb.width+1&&arrows.y+arrows.height<=thumb.y+thumb.height+1,'Both arrows belong inside the yellow thumb');}
   assert(ready.leftCenter[1]<ready.cutPoint[1],'Default support is below the cutter near the bend radius');
   await moveHand(-1,35);const crossing=await capture('hand-crossing');assert(crossing.cutterRetreat>.8,'Shears must pull aside while the support passes their plane');assert.equal(crossing.cutterReady,false);if(mobile)await page.locator('#look-joystick').tap();else{await page.mouse.down();await step(1);await page.mouse.up();}await step(2);assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.phase),'fitting','Cutting must wait for the support to clear');await moveHand(-1,55);await step(15);const up=await capture('hand-up');assert(up.leftCenter[1]>up.cutPoint[1],'Up control must permit holding above the cutter');
   await moveHand(1,120);const down=await capture('hand-down');assert(down.leftCenter[1]<down.cutPoint[1],'Down control must permit holding below the cutter and on the bend');assert(down.supportS>.3,'Lower grip follows the bend radius');assert(Math.hypot(...down.camera.map((v,i)=>v-camera[i]))<.001,'Hand controls must not move the player');
   await page.evaluate(s=>window.__wireTheHouse.pvc.supportS=s,ready.supportS);await step(15);const stopped=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc,saved=p.cutS;window.__wireTheHouse.player.lookHandler(0,(p.supportS-p.cutS)/.0006);return{saved,cut:p.cutS,gap:Math.abs(p.supportPlaneGap(p.supportS))};});assert(stopped.gap>=.105,'Moving the cutter must stop before the support hand');await step(3);await capture('cutter-stop');await page.evaluate(s=>window.__wireTheHouse.pvc.setCut(s),stopped.saved);await step(15);report.controls.push({mobile,upS:up.supportS,downS:down.supportS,arrows:mobile});
  }
  if(mobile)await page.locator('#look-joystick').tap();else{await page.mouse.down();await step(1);await page.mouse.up();}
  await step(12);await capture('squeeze');if(!baseline){await moveHand(-1,8);await capture('cut-hand-stop');}await step(25);const cut=await capture('cut');assert.equal(cut.phase,'cut');assert.equal(cut.offcuts,1);assert.equal(cut.cutFrom,cut.cutS);
  if(!baseline){
   await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.cutS=.281;p.cutFrom=0;p.supportS=null;p.transition('fitting');});
   await step(40);await capture('near-bend');
   if(mobile){await page.locator('#pvc-fit-zoom').tap();await step(80);await capture('zoom');await page.locator('#pvc-fit-zoom').tap();await step(80);}
   for(const pose of report.poses.filter(p=>p.mobile===mobile)){
    assert(pose.planeAlignment>.995,'Blade plane must be perpendicular to the pipe axis');if(pose.cutterReady)assert(pose.cutAnchorErrorM<.001,'Seated jaw must stay on the selected cut');assert(pose.leftSkinGapM>.002,'Actual left glove skin must clear both the metal support and moving blade');assert(Math.abs(pose.reach.R)<.01,'Right wrist must remain seated');assert(Math.abs(pose.reach.L)<.01,'Left wrist must remain seated on the pipe');
    assert(pose.fingers.every(f=>f.gapM>=-.003&&f.gapM<.012),'All right fingers must close on the actual handle without penetration');assert(pose.leftFingers.filter(f=>f.gapM>=-.003&&f.gapM<.015).length>=3,'Left fingers must grasp the actual straight pipe or bend');assert(pose.wristBendDegrees<35,'Right wrist must remain straight');
   }
   await page.keyboard.press('Escape');await step(3);assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.focused),false,'Escape exits the cutting position');
   if(mobile)assert.equal(await page.locator('.pvc-hand-arrows').isVisible(),false,'Arrows disappear outside pipe work');
   const before=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.toArray());await page.keyboard.down('KeyS');await step(35);await page.keyboard.up('KeyS');const after=await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.toArray());assert(Math.hypot(after[0]-before[0],after[2]-before[2])>.05,'W/S returns to normal movement after Escape');
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({out,passed:report.passed,errors:report.errors,controls:report.controls,performance:report.performance,poses:report.poses.map(p=>({mobile:p.mobile,name:p.name,reach:p.reach,plane:p.planeAlignment,right:p.fingers,left:p.leftFingers}))}));
