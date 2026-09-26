import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockPointerLock } from '../tests/browser-safety.mjs';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const phase = process.argv[2] ?? 'before';
const output = path.join(root, 'output/forge-hammer-wrists', phase);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mobile=process.env.QA_MOBILE==='1';
const context = await browser.newContext({ viewport: mobile?{width:390,height:844}:{width:1366,height:768}, isMobile:mobile, hasTouch:mobile });
await blockPointerLock(context);
await context.route('http://127.0.0.1:5365/favicon.ico', route => route.fulfill({ status: 204 }));
// Production static builds have no local editor-save API. Isolate this test
// from the user's saved levels, using the endpoint's empty-list contract.
await context.route('http://127.0.0.1:5365/__wire-house-mansion-level?list=1', route => route.fulfill({ json:{slots:[]} }));
// Test the isolated build on the project's one origin without replacing a listener.
if(process.env.QA_LIVE!=='1')await context.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
  const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
  const filename = path.resolve(root, 'dist', relative);
  if (!filename.startsWith(path.resolve(root, 'dist') + path.sep)) return route.abort();
  const contentType = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm' }[path.extname(filename)];
  try { await route.fulfill({ status: 200, body: await readFile(filename), contentType }); }
  catch { await route.abort(); }
});
const page = await context.newPage(), errors = [], report = { phase, cases: [], errors };
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
page.on('requestfailed', request => errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
const capture = async name => {
  await page.evaluate(async () => {
    const g = window.__wireTheHouse;
    await g.renderer.waitForFrame(); g.renderer.render(); await g.renderer.waitForFrame();
  });
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  report.cases.push(await page.evaluate(name => {
    const g = window.__wireTheHouse, h = g.fpsRig.tools.get('hammer'), c = g.renderer.camera, V = c.position.constructor;
    const body = h.localToWorld(new V(.02, -.055, -.1)), materials = new Set();
    h.traverseVisible(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
    // Deformed glove/hand vertices against the actual authored casing
    // extrusions; endpoint contact alone cannot detect a palm inside a motor.
    const solids=h.userData.handClearanceSolids??[],penetration={samples:0,inside:0,maxDepthM:0,parts:{}};
    const depth=(p,solid)=>{
      const x=-p.z,y=p.y,poly=solid.outline;let inside=false,edge=Infinity;
      for(let i=0,j=poly.length-1;i<poly.length;j=i++){
        const [ax,ay]=poly[j],[bx,by]=poly[i];
        if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
        const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
        edge=Math.min(edge,Math.hypot(x-ax-t*dx,y-ay-t*dy));
      }
      return inside?Math.min(edge,solid.width*.5-Math.abs(p.x-solid.centerX))-Math.max(.003,solid.bevel):0;
    };
    g.workerBody.traverse(m=>{
      if(!m.isSkinnedMesh)return;
      const indices=m.geometry.attributes.skinIndex,weights=m.geometry.attributes.skinWeight;
      const hands=new Set(m.skeleton.bones.map((b,i)=>/^(hand|thumb|index|middle|ring|little)/i.test(b.name)?i:-1));hands.delete(-1);
      const p=new V();
      for(let i=0;i<indices.count;i++){
        let weight=0;for(let j=0;j<4;j++)if(hands.has(indices.getComponent(i,j)))weight+=weights.getComponent(i,j);
        if(weight<.5)continue;
        penetration.samples++;m.getVertexPosition(i,p);h.worldToLocal(m.localToWorld(p));
        for(const solid of solids){const d=depth(p,solid);if(d>.0005){penetration.inside++;penetration.maxDepthM=Math.max(penetration.maxDepthM,d);penetration.parts[solid.name]=(penetration.parts[solid.name]??0)+1;}}
      }
    });
    const wrists={};
    for(const side of ['L','R']) {
      const b=g.workerBody, hand=b.bone('hand.'+side), q=hand.getWorldQuaternion(c.quaternion.clone());
      const fore=b.point('hand.'+side).sub(b.point('forearm.'+side)).normalize();
      const neutral=new V(0,1,0).applyQuaternion(q.clone().multiply(b.handFrames.get(side).foreToHand.clone().invert()));
      const palm=b.point('middle.01.'+side).sub(b.point('hand.'+side)).normalize();
      wrists[side]={bendDegrees:fore.angleTo(neutral)*180/Math.PI,palmDegrees:fore.angleTo(palm)*180/Math.PI,hand:b.point('hand.'+side).toArray(),elbow:b.point('forearm.'+side).toArray(),shoulder:b.point('upper_arm.'+side).toArray(),knuckle:b.point('middle.01.'+side).toArray()};
    }
    return { name, wrists, penetration, asset:h.userData.visualAsset, camera:c.position.toArray(), upY:new V(0,1,0).applyQuaternion(h.getWorldQuaternion(c.quaternion.clone())).y, status: g.fpsRig.contactStatus, reachable: g.fpsRig.gripsReachable(c, h), motorEyeM: body.distanceTo(c.position), motorNdc: body.project(c).toArray(), pose: g.fpsRig.debugPose(), body: g.workerBody.telemetry, materials: [...materials].map(m => ({ name: m.name, opacity: m.opacity, depthTest: m.depthTest, depthWrite: m.depthWrite })), drawCalls: g.renderer.webgl.info.render.calls||null, triangles: g.renderer.webgl.info.render.triangles||null, renderError: g.renderer.renderError };
  }, name));
};
try {
  await page.goto('http://127.0.0.1:5365/Electrical-Game/'+(process.env.QA_WEBGPU==='1'?'':'?renderer=webgl'));
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await page.locator('#start-button').click();
  if(mobile){await page.locator('#worker-bar-handle').tap();await page.locator('#mobile-tool-slider [data-tool="hammer"]').tap();}
  else await page.keyboard.press('Digit4');
  await page.addStyleTag({ content: '#fps-counter { visibility: hidden !important; }' });
  await page.evaluate(async () => {
    const g = window.__wireTheHouse; await g.renderer.waitForFrame();
    window.qaStep = g.step.bind(g); g.step = () => {};
    for (let i = 0; i < 90; i++) window.qaStep(1/60, 1/60, false);
  });
  await capture('idle');
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.set(0,1.65,g.room.brickWall.volume.frontZ+1.18);g.player.yaw=0;g.player.pitch=-.40;g.player.workPosition.locked=true;g.player.workPosition.targetDistanceM=1.18;for(let i=0;i<90;i++)window.qaStep(1/60,1/60,false);});
  await capture('chest-work');
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor;
    window.qaObserver={position:c.position.clone(),quaternion:c.quaternion.clone(),fov:c.fov,parent:g.fpsRig.parent};
    g.renderer.scene.attach(g.fpsRig);c.position.add(new V(2.1,.15,.45));c.lookAt(window.qaObserver.position.clone().add(new V(0,-.7,-.25)));c.fov=55;c.updateProjectionMatrix();g.workerBody.headMaterials.forEach(m=>{m.colorWrite=true;m.depthWrite=true;});g.renderer.render();});
  await page.screenshot({path:path.join(output,'chest-observer.png')});
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,s=window.qaObserver;c.position.copy(s.position);c.quaternion.copy(s.quaternion);c.fov=s.fov;c.updateProjectionMatrix();c.updateMatrixWorld(true);s.parent.attach(g.fpsRig);g.workerBody.headMaterials.forEach(m=>{m.colorWrite=false;m.depthWrite=false;});g.renderer.render();});


  for (const distance of [.9, 1.05, 1.12]) {
    await page.evaluate(distance => {
      const g = window.__wireTheHouse;
      g.renderer.camera.position.set(0, 1.65, g.room.brickWall.volume.frontZ + distance);
      g.player.workPosition.locked = true;
      g.player.workPosition.targetDistanceM = distance;
      g.player.yaw = 0; g.player.pitch = -.18;
      for (let i = 0; i < 90; i++) window.qaStep(1/60, 1/60, false);
    }, distance);
    await capture(`work-${distance}`);
  }
  if (true) {
    await page.keyboard.down('KeyW');
    await page.evaluate(() => { for (let i=0;i<90;i++) window.qaStep(1/60,1/60,false); });
    await page.keyboard.up('KeyW');
    await capture('approach');
    await page.evaluate(() => { const g=window.__wireTheHouse; g.step=window.qaStep; g.input.actionHeld=true; window.qaStartImpacts=g.room.brickWall.impactCount; });
    await page.waitForTimeout(2000);
    await capture('striking');
    report.held=await page.evaluate(() => { const g=window.__wireTheHouse;g.input.actionHeld=false;g.step=()=>{};return {impacts:g.room.brickWall.impactCount-window.qaStartImpacts,grips:g.workerBody.telemetry.gripReachErrors}; });
    if(mobile)await page.evaluate(()=>window.dispatchEvent(new CustomEvent('wirehouse:hammer-view-side',{detail:1})));
    else await page.locator('#hammer-view-left').click();
    await page.evaluate(() => { for (let i=0;i<4;i++) window.qaStep(1/60,1/60,false); });
    await capture('swap-mid');
    await page.evaluate(() => { for (let i=0;i<90;i++) window.qaStep(1/60,1/60,false); });
    await capture('left');
    await page.evaluate(() => {
      const g=window.__wireTheHouse;
      g.renderer.camera.position.set(15.3,1.65,15);g.player.yaw=Math.PI;g.player.pitch=0;
      g.player.workPosition.locked=false;g.player.workPosition.released=true;
      for(let i=0;i<90;i++)window.qaStep(1/60,1/60,false);
    });
    await capture('courtyard');
    report.masonry=await page.evaluate(() => {const g=window.__wireTheHouse,c=g.renderer.camera,aim=g.room.mansionWing.aimMasonry(c);return {aim:aim?.point.toArray(),tip:g.fpsRig.chiselTipWorld.toArray(),gap:aim?.point.distanceTo(g.fpsRig.chiselTipWorld)};});
    await page.evaluate(()=>{const g=window.__wireTheHouse;g.fpsRig.setSideHandleAngleDegrees(45);for(let i=0;i<90;i++)window.qaStep(1/60,1/60,false);});
    await capture('handle-rotated');
    for(const angle of [-90,90,180,0]){
      await page.evaluate(angle=>{const g=window.__wireTheHouse;g.fpsRig.setSideHandleAngleDegrees(angle);for(let i=0;i<120;i++)window.qaStep(1/60,1/60,false);},angle);
      await capture('handle-'+angle);
    }
    report.performance=await page.evaluate(async()=>{
      const g=window.__wireTheHouse;g.step=window.qaStep;g.input.actionHeld=false;
      return await new Promise(resolve=>{const times=[];let last=performance.now();const start=last;function frame(now){times.push(now-last);last=now;if(now-start<2200)requestAnimationFrame(frame);else{g.step=()=>{};times.sort((a,b)=>a-b);resolve({fps:times.length*1000/(now-start),p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),renderError:g.renderer.renderError});}}requestAnimationFrame(frame);});
    });
    if(process.env.QA_AB==='1'){
      report.depthPerformanceAB=[];
      for(const depth of [false,true]){
        await page.evaluate(depth=>{const g=window.__wireTheHouse;g.fpsRig.tools.get('hammer').traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.depthTest=depth;m.depthWrite=depth;m.needsUpdate=true;}});g.step=window.qaStep;},depth);
        await page.waitForTimeout(500);
        report.depthPerformanceAB.push(await page.evaluate(depth=>new Promise(resolve=>{const g=window.__wireTheHouse, times=[];let last=performance.now();const start=last;function frame(now){times.push(now-last);last=now;if(now-start<2200)requestAnimationFrame(frame);else{g.step=()=>{};times.sort((a,b)=>a-b);resolve({depth,fps:times.length*1000/(now-start),p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)});}}requestAnimationFrame(frame);}),depth));
      }
    }
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if(phase.startsWith('final')){
    assert.deepEqual(errors,[]);
    for(const result of report.cases){
      assert.equal(result.renderError,'');
      assert.equal(result.asset,'SDS Max reference Blender GLB');
      assert(result.penetration.samples>500,'Missing deformed hand surface test');
      assert.equal(result.penetration.inside,0,`${result.name}: hand inside housing ${JSON.stringify(result.penetration)}`);
      assert(Object.values(result.wrists).every(w=>w.bendDegrees<15),`${result.name}: wrist bend ${JSON.stringify(result.wrists)}`);
      assert(result.materials.every(m=>m.depthTest&&m.depthWrite&&m.opacity===1),`${result.name}: opaque depth`);
      assert(result.reachable,`${result.name}: finite control grips`);
      assert(result.upY>0,`${result.name}: hammer rolled upside down`);
      assert(Object.values(result.body.gripReachErrors).every(error=>error<.006),`${result.name}: anatomical hand missed grip ${JSON.stringify(result.body.gripReachErrors)}`);
    }
    assert(report.held.impacts>=3,'Continuous held percussion stopped');
    assert(report.masonry.gap<.003,`Visible chisel misses masonry by ${report.masonry.gap}`);
    const a=report.cases.find(c=>c.name==='approach').camera,b=report.cases.find(c=>c.name==='striking').camera;
    assert(Math.hypot(...a.map((v,i)=>v-b[i]))<.002,'Held percussion moved the camera');
  }
  console.log(JSON.stringify({ output, errors, cases: report.cases.map(({ name, wrists, body }) => ({ name, wrists, gripErrors:body.gripReachErrors })) }, null, 2));
} finally { await browser.close(); }
