import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const url=process.env.HAMMER_FLOW_URL??'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out=process.env.HAMMER_FLOW_OUT??'output/hammer-flow/after';
const baseline=process.env.HAMMER_FLOW_BASELINE==='1';
await mkdir(out,{recursive:true});
const report={url,baseline,build:process.env.TASK_BUILD_ROOT??'live source',mobileIsEmulation:true,
  fixture:'Same fixed initial scene/view and deterministic production steps; native mouse, keyboard, and concurrent MOVE + right-stick USE taps. No substituted contacts, damage, poses or movement.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const percentile=(v,p)=>[...v].sort((a,b)=>a-b)[Math.floor((v.length-1)*p)];
try{
for(const mobile of [false,true])for(const scene of ['original','north'])for(const side of [-1,0,1]){
  if(scene==='north'&&side===0)continue;
  if(process.env.HAMMER_FLOW_SHORT==='1'&&(mobile||side!==1))continue;
  if(process.env.HAMMER_FLOW_FRONT_ONLY==='1'&&(mobile||scene!=='original'||side!==0))continue;
  const name=`${mobile?'mobile':'desktop'}-${scene}-${side===0?'front':side<0?'left':'right'}`;
  if(process.env.HAMMER_FLOW_MATCH&&!new RegExp(process.env.HAMMER_FLOW_MATCH).test(name))continue;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
  await blockPointerLock(context);await serveTaskBuild(context,url);
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));
  await p.goto(url);await p.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
  await p.locator('#apprentice-count').selectOption('0');
  const click=id=>p.locator(id)[mobile?'tap':'click']();await click('#start-button');
  if(mobile){await click('#worker-bar-handle');await click('#mobile-tool-slider [data-tool="hammer"]');}else await p.keyboard.press('Digit4');
  await p.evaluate(({scene,side,mode,angleDegrees})=>{
    const g=window.__wireTheHouse,c=g.renderer.camera;window.__flowStep=g.step.bind(g);g.step=()=>{};
    g.player.workPosition.locked=false;g.player.workPosition.released=false;g.hammerMode=mode;g.hammerSpeed=2.5;
    const angle=side*angleDegrees*Math.PI/180;
    if(scene==='original'){c.position.set(Math.tan(angle)*.65,1.65,g.room.brickWall.volume.frontZ+.65);g.player.yaw=angle;}
    else {c.position.set(15.3,1.65,15);g.player.yaw=Math.PI+angle;}
    g.player.pitch=-.18;c.rotation.set(g.player.pitch,g.player.yaw,0);
    window.__flowScene=scene;
  },{scene,side,mode:process.env.HAMMER_FLOW_MODE??'chase',angleDegrees:Number(process.env.HAMMER_FLOW_ANGLE??55)});
  const step=n=>p.evaluate(async n=>{const g=window.__wireTheHouse;for(let i=0;i<n;i++){window.__flowStep(1/60);if(i%12===0){await g.chasing.waitForDebrisSplits();await g.renderer.waitForFrame();}}},n);
  const state=()=>p.evaluate(()=>{
    const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor,h=g.fpsRig.tools.get('hammer');
    const wall=window.__flowScene==='north'?g.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure'):null;
    const plane=g.player.wallWorkPlane??(wall?{normal:new V(0,0,-1),point:wall.group.localToWorld(new V(0,0,-.12))}:{normal:new V(0,0,1),point:new V(0,0,g.room.brickWall.volume.frontZ)});
    const tangent=new V(0,1,0).cross(plane.normal),direction=c.getWorldDirection(new V());
    const depth=c.position.clone().sub(plane.point).dot(plane.normal),entry=c.position.clone().addScaledVector(direction,-depth/direction.dot(plane.normal));
    const tip=g.fpsRig.chiselTipWorld.clone(),tool=h.getWorldPosition(new V());
    return {camera:c.position.toArray(),tip:tip.toArray(),entry:entry.toArray(),relativeTip:tip.clone().sub(entry).toArray(),relativeTool:tool.sub(entry).toArray(),orientation:h.getWorldQuaternion(c.quaternion.clone()).toArray(),
      tangent:tangent.toArray(),depth,desired:g.player.wallWorkDistance,target:g.player.workPosition.targetDistanceM,locked:g.player.workPosition.locked,held:g.input.actionHeld,yaw:g.player.yaw,pitch:g.player.pitch,side:g.hammerWorkStance.sideDegrees,
      status:g.fpsRig.contactStatus,reachable:g.fpsRig.reachable,inAir:g.fpsRig.chiselInAir,removed:wall?wall.removedClayNodes:g.room.brickWall.volume.removedNodeCount,
      inwardPurchase:-new V(0,0,-1).applyQuaternion(h.getWorldQuaternion(c.quaternion.clone())).dot(plane.normal),
      pose:g.fpsRig.debugPose(),renderError:g.renderer.renderError,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  await step(180);
  if(process.env.HAMMER_FLOW_APPROACH==='1'){await p.keyboard.down('KeyW');await step(90);await p.keyboard.up('KeyW');await step(120);}
  const idle=await state();await p.screenshot({path:`${out}/${name}-idle.png`});
  const cdp=mobile?await context.newCDPSession(p):null;let points=[];
  const touch=async(type,next)=>{points=next;await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});};
  async function use(){if(mobile){const b=await p.locator('#look-joystick').boundingBox();const a={id:2,x:b.x+b.width/2,y:b.y+b.height/2};await touch('touchStart',[...points,a]);await touch('touchEnd',points.filter(q=>q.id!==2));}else if((await state()).held)await p.mouse.up();else {await p.mouse.move(683,384);await p.mouse.down();}}
  await use();await step(30);const start=await state();
  const trace=await p.evaluate(async()=>{
    const g=window.__wireTheHouse,c=g.renderer.camera,h=g.fpsRig.tools.get('hammer'),V=c.position.constructor;
    const samples=[],cpu=[],frames=[];let previous=performance.now();
    for(let i=0;i<180;i++){
      const began=performance.now();window.__flowStep(1/60);cpu.push(performance.now()-began);
      if(i%12===0)await g.chasing.waitForDebrisSplits();
      await g.renderer.waitForFrame();const now=performance.now();frames.push(now-previous);previous=now;
      samples.push({camera:c.position.toArray(),tip:g.fpsRig.chiselTipWorld.toArray(),tool:h.getWorldPosition(new V()).toArray(),orientation:h.getWorldQuaternion(c.quaternion.clone()).toArray(),status:g.fpsRig.contactStatus,side:g.hammerWorkStance.sideDegrees});
    }return {samples,cpu,frames};
  });
  const stationary=await state();await p.screenshot({path:`${out}/${name}-held.png`});
  const anchor=mobile?await p.locator('#joystick').boundingBox():null;
  const move=anchor?{id:1,x:anchor.x+anchor.width*.5,y:anchor.y+anchor.height*.5}:null;
  const travelSide=side||1;
  if(mobile){await touch('touchStart',[move]);await touch('touchMove',[{...move,x:move.x+travelSide*46}]);}else await p.keyboard.down(travelSide<0?'KeyA':'KeyD');
  const moving=[],movingTrace=[];
  for(let i=0;i<12;i++){
    const burst=await p.evaluate(async()=>{
      const g=window.__wireTheHouse,c=g.renderer.camera,h=g.fpsRig.tools.get('hammer'),V=c.position.constructor,result=[];
      for(let j=0;j<15;j++){window.__flowStep(1/60);result.push({camera:c.position.toArray(),tip:g.fpsRig.chiselTipWorld.toArray(),tool:h.getWorldPosition(new V()).toArray()});if(j%12===0)await g.chasing.waitForDebrisSplits();}
      return result;
    });
    movingTrace.push(...burst);moving.push(await state());
  }
  if(mobile)await touch('touchEnd',[]);else await p.keyboard.up(travelSide<0?'KeyA':'KeyD');
  await p.screenshot({path:`${out}/${name}-strafe.png`});await use();
  // Backward releases the brace; later idle frames must not reattach it.
  if(mobile){await touch('touchStart',[move]);await touch('touchMove',[{...move,y:move.y+46}]);}else await p.keyboard.down('KeyS');
  await step(12);if(mobile)await touch('touchEnd',[]);else await p.keyboard.up('KeyS');await step(30);const released=await state();
  let maxTipStep=0,maxToolStep=0,maxAngleStep=0;
  for(let i=1;i<trace.samples.length;i++){const a=trace.samples[i-1],b=trace.samples[i];maxTipStep=Math.max(maxTipStep,dist(a.tip,b.tip));maxToolStep=Math.max(maxToolStep,dist(a.tool,b.tool));const dot=Math.min(1,Math.abs(a.orientation.reduce((s,v,j)=>s+v*b.orientation[j],0)));maxAngleStep=Math.max(maxAngleStep,2*Math.acos(dot));}
  const item={name,idle,start,stationary,lastMove:moving.at(-1),released,maxTipStep,maxToolStep,maxAngleStep,
    performance:{cpuP95Ms:percentile(trace.cpu,.95),cpuMaxMs:Math.max(...trace.cpu),stepIntervalP95Ms:percentile(trace.frames,.95),stepIntervalMaxMs:Math.max(...trace.frames),intervalsOver50:trace.frames.filter(x=>x>50).length}};
  report.cases.push(item);await writeFile(`${out}/${name}-trace.json`,JSON.stringify({trace,moving,movingTrace}));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,depth:idle.depth,desired:idle.desired,locked:idle.locked,status:idle.status,removed:stationary.removed-start.removed,strafeRemoved:moving.at(-1).removed-stationary.removed,maxTipStep,maxToolStep,maxAngleStep,performance:item.performance}));
  if(!baseline){
    assert(idle.locked,`${name}: nearby hammer never snapped to wall`);assert(Math.abs(idle.depth-idle.target)<.003,`${name}: snap distance did not settle`);
    assert(Math.abs(idle.depth-idle.desired)<.025,`${name}: snapped to the old arbitrary distance`);
    assert(idle.inwardPurchase>.70,`${name}: side-view chisel points along the facade instead of into the brick`);
    assert(Math.abs(Math.abs(idle.side)-15)<.02,`${name}: view yaw changed the selected wall attack`);
    assert(start.held,`${name}: native USE did not hold percussion`);assert(stationary.removed>idle.removed,`${name}: stationary percussion did not remove actual clay`);
    assert(maxTipStep<=.0051&&maxToolStep<=.0051,`${name}: hammer reset between strikes`);assert(maxAngleStep<.001,`${name}: housing rotated on each new brick face`);
    assert(dist(start.camera,stationary.camera)<1e-8,`${name}: strikes repositioned player`);
    assert(moving.at(-1).removed>stationary.removed,`${name}: held side chiselling removed no clay`);
    const travel=moving.at(-1).camera.reduce((s,v,j)=>s+(v-stationary.camera[j])*stationary.tangent[j],0);
    assert(travel*travelSide>.15,`${name}: A/D or stick did not traverse the wall`);
    for(const s of moving){assert(Math.abs(s.depth-stationary.depth)<1e-8,`${name}: strafe changed standoff`);assert.equal(s.yaw,stationary.yaw);assert.equal(s.pitch,stationary.pitch);assert.equal(s.side,stationary.side);assert(!s.overflow);assert.equal(s.renderError,'');}
    for(const s of [idle,start,stationary,...moving])for(const arm of s.pose.arms){
      assert(Math.abs(dist(arm.shoulder,arm.elbow)-.31)<1e-5,`${name}: upper arm stretched`);
      assert(Math.abs(dist(arm.elbow,arm.wrist)-.27)<1e-5,`${name}: forearm stretched`);
    }
    for(let i=1;i<movingTrace.length;i++){
      const a=movingTrace[i-1],b=movingTrace[i];
      const tipTravel=b.tip.reduce((s,v,j)=>s+(v-a.tip[j])*stationary.tangent[j],0)*travelSide;
      assert(tipTravel>=-.0002,`${name}: bit reset against the held movement`);
      assert(dist(a.tool,b.tool)<.008,`${name}: moving hammer jumped between bricks`);
    }
    assert(!released.locked,`${name}: backward input failed to release brace`);
  }
  await context.close();
}
assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=String(e.stack??e);throw e;}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
