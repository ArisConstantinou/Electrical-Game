import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const output = resolve(process.argv[3] ?? 'output/qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const report = { url: baseUrl, browser: browser.version(), mobileIsEmulation: true, scenarios: [], errors };
const freezeHotUpdates=process.env.QA_FREEZE_HMR==='1';report.hotUpdatesFrozen=freezeHotUpdates;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const mortarTouchSessions = new WeakMap();
const snap = async (page, name) => {
  await page.evaluate(async () => { await window.__wireTheHouse.room.brickWall.waitForGeometry(); window.__wireTheHouse.renderer.render(); });
  await page.screenshot({ path: join(output, `${name}.png`) });
  await writeFile(join(output, `${name}.json`), JSON.stringify(await state(page), null, 2));
};
async function createPage(mobile = false) {
  const page = await browser.newPage(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Opt-in diagnostic snapshot during parallel development. Final validation
  // leaves this unset; game modules, physics and inputs are never intercepted.
  if(freezeHotUpdates)await page.route('**/@vite/client',async route=>{const response=await route.fetch(),body=await response.text();const needle='async function handleMessage(payload) {';assert(body.includes(needle),'Unknown Vite HMR client');await route.fulfill({response,body:body.replace(needle,`${needle}\nif(payload.type==='update'||payload.type==='full-reload')return;`)});});
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#start-button')[mobile ? 'tap' : 'click']();
  await page.waitForTimeout(150);
  // Fixtures position the player and aim. Wall state and mission stages are
  // never mutated: Input -> Game -> InteractionSystem handles every action.
  await page.evaluate(() => {
    window.__gameplayQA = {
      aim(x, y, z = -2.41) {
        const game = window.__wireTheHouse;
        game.renderer.camera.position.set(x, game.player.eyeHeight, -1.0);
        game.renderer.camera.lookAt(x, y, z);
        // The crosshair chooses a FRONT-plane entry, while the oblique chisel
        // travels along its own axis. Solve the entry that reaches this read-only
        // material probe, including independent world-space downward and lateral tilt.
        if (game.selectedTool === 'hammer' && z < game.room.brickWall.volume.frontZ) {
          const camera = game.renderer.camera, wall = game.room.brickWall;
          const tilt = wall.chiselTiltDegrees * Math.PI / 180;
          for (let iteration = 0; iteration < 10; iteration++) {
            const direction = camera.position.clone().set(Math.sin(wall.chiselSideDegrees*Math.PI/180)*Math.cos(tilt), -Math.sin(tilt), -Math.cos(wall.chiselSideDegrees*Math.PI/180)*Math.cos(tilt)).normalize();
            if (direction.z >= -.04) break;
            const travel = (z - wall.volume.frontZ) / direction.z;
            camera.lookAt(x - direction.x * travel, y - direction.y * travel, wall.volume.frontZ);
          }
        }
        game.player.yaw = game.renderer.camera.rotation.y;
        game.player.pitch = game.renderer.camera.rotation.x;
        game.renderer.camera.updateMatrixWorld(true);
      },
      press() {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true }));
        window.advanceTime(17);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e', bubbles: true }));
        window.advanceTime(250);
      },
      touch(continuous = false, target = null, holdMs = 17) {
        const pad = document.querySelector('#look-joystick'), r = pad.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const dispatch = (type, dx = 0) => pad.dispatchEvent(new PointerEvent(type, { pointerId: 811, pointerType: 'touch', clientX: x + dx, clientY: y, bubbles: true, cancelable: true }));
        dispatch('pointerdown');
        if (continuous) dispatch('pointermove', 10);
        if(target)window.__gameplayQA.aim(target.x,target.y,target.z ?? -2.41);
        window.advanceTime(holdMs);
        dispatch('pointerup', continuous ? 10 : 0);
        window.advanceTime(250);
      },
    };
  });
  return page;
}
const select = async (page, tool, mobile = false) => {
  const keys = { spring: 'Digit1', cutter: 'Digit2', spray: 'Digit3', hammer: 'Digit4', fitting: 'Digit5', level: 'Digit6', trowel: 'Digit7', hose: 'Digit8' };
  if (mobile) await page.locator(`[data-tool="${tool}"]`).tap();
  else await page.keyboard.press(keys[tool]);
  await page.evaluate(() => window.advanceTime(17));
  assert((await state(page)).mission.selectedTool === tool, `Cannot select ${tool}`);
};
const aimActive = page => page.evaluate(() => {
  const p = window.__wireTheHouse.mission.activePoint.position;
  window.__gameplayQA.aim(p.x, p.y, p.z);
});
const action = async (page, mobile = false) => {
  if (mobile) await page.evaluate(() => window.__gameplayQA.touch(false));
  else { await page.keyboard.press('KeyE'); await page.evaluate(() => window.advanceTime(267)); }
};
async function assertLayout(page, mobile) {
  const layout = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('button, [data-tool] span, #aim-control-label')].filter(element => {
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    });
    const badFonts = labels.filter(element => Number.parseFloat(getComputedStyle(element).fontSize) < 12).map(element => ({ text: element.textContent.trim().slice(0, 40), px: getComputedStyle(element).fontSize }));
    return { width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,badFonts };
  });
  assert(layout.scrollWidth<=layout.width+1 && layout.scrollHeight<=layout.height+1,`Overflow: ${JSON.stringify(layout)}`);
  assert(!layout.badFonts.length,`Unreadable labels: ${JSON.stringify(layout.badFonts)}`);
  if(mobile)for(const selector of ['#joystick','#look-joystick','[data-tool="hammer"]','#settings-toggle'])assert(await page.locator(selector).isVisible(),`Hidden mobile control ${selector}`);
  return layout;
}
async function markPoint(page,mobile,relocate=false) {
  await select(page,'spray',mobile);
  const before=await page.evaluate(()=>{const p=window.__wireTheHouse.mission.activePoint.position;return{x:p.x,y:p.y}});
  const target={x:before.x+(relocate?.13:0),y:before.y+(relocate?.10:0)};
  await page.evaluate(target=>window.__gameplayQA.aim(target.x,target.y),target);
  if(mobile)await page.evaluate(target=>window.__gameplayQA.touch(true,target),target);else await action(page);
  const after=await state(page);
  assert(after.activePoint.stage==='marked',`Spray failed to mark point: ${JSON.stringify(after)}`);
  if(relocate){const actual=await page.evaluate(()=>({...window.__wireTheHouse.mission.activePoint.position}));assert(Math.abs(actual.x-before.x)>.07 && Math.abs(actual.y-before.y)>.04,'First spray did not relocate point');}
  assert(after.workSurface.freeSprayMarks>0,'No persistent paint');
}
async function chiselControls(page, mobile) {
  const tap = selector => page.locator(selector)[mobile ? 'tap' : 'click']();
  const initial = (await state(page)).workSurface;
  await tap('#chisel-tilt');
  const tilted = (await state(page)).workSurface;
  assert(tilted.chiselTiltDegrees !== initial.chiselTiltDegrees, 'Hammer tilt control does not affect the tool');
  assert(tilted.chiselEdgeDegrees === initial.chiselEdgeDegrees, 'Hammer pitch unexpectedly rolls the blade');
  await tap('#chisel-side');
  const sideways=(await state(page)).workSurface;
  assert(sideways.chiselSideDegrees!==initial.chiselSideDegrees && sideways.chiselTiltDegrees===tilted.chiselTiltDegrees && sideways.chiselEdgeDegrees===initial.chiselEdgeDegrees,'Side lean is not independently adjustable');
  for(let i=0;i<6 && (await state(page)).workSurface.chiselSideDegrees!==initial.chiselSideDegrees;i++) await tap('#chisel-side');
  await tap('#chisel-angle');
  const rolled = (await state(page)).workSurface;
  assert(rolled.chiselEdgeDegrees !== tilted.chiselEdgeDegrees && rolled.chiselTiltDegrees === tilted.chiselTiltDegrees, 'Blade roll and hammer tilt are not independent');
  for (let index = 0; index < 4 && (await state(page)).workSurface.chiselEdgeDegrees !== initial.chiselEdgeDegrees; index++) await tap('#chisel-angle');
  for (let index = 0; index < 10 && (await state(page)).workSurface.chiselTiltDegrees !== initial.chiselTiltDegrees; index++) await tap('#chisel-tilt');
  assert((await state(page)).workSurface.chiselTiltDegrees === 25, 'Default downward hammer pitch could not be restored');
  if (!mobile) {
    await page.keyboard.press('BracketRight');
    assert((await state(page)).workSurface.chiselTiltDegrees === 30, '] did not increase pitch');
    await page.keyboard.press('BracketLeft');
    assert((await state(page)).workSurface.chiselTiltDegrees === 25, '[ did not decrease pitch');
  }
}
// Read occupied nodes in the box/pipe envelope and aim ordinary tool inputs at
// obstructions. Each camera ray must still remove all intervening shell/ribs.
async function excavate(page,mobile,conduit=false) {
  await select(page,'hammer',mobile);
  let strikes=0;
  for(;strikes<1600;){
    const result=await page.evaluate(({mobile,conduit})=>{
      const game=window.__wireTheHouse,wall=game.room.brickWall,volume=wall.volume,point=game.mission.activePoint;
      const complete=()=>conduit?wall.canFitConduit(point):wall.canFitBoxes(point)&&wall.getChaseCoverage(point.definition.id)>=.98;
      let used=0;
      for(;used<20&&!complete();used++){
        const p=point.position,halfWidth=conduit?.013:point.boxGroup.groupWidth/2+.010;
        const min={x:p.x-halfWidth,y:conduit?.071:p.y-.049,z:conduit?-2.447:p.z-.050};
        const max={x:p.x+halfWidth,y:conduit?p.y-point.boxGroup.groupHeight/2:p.y+.049,z:conduit?-2.419:p.z+.001};
        const coords=v=>({x:Math.round((v.x+volume.width/2)/volume.hx+.5),y:Math.round(v.y/volume.hy+.5),z:Math.round((volume.frontZ-v.z)/volume.hz+.5)});
        const a=coords(min),b=coords(max);let target=null;
        outer:for(let z=Math.min(a.z,b.z);z<=Math.max(a.z,b.z);z++)for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++)for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++)if(volume.nodeMaterial(x,y,z)){target=volume.nodePosition(x,y,z);break outer;}
        if(!target){target=wall.samples.get(point.definition.id)?.find(sample=>!volume.cavityBox({x:sample.x-.009,y:sample.y-.009,z:-2.45},{x:sample.x+.009,y:sample.y+.009,z:-2.411}).clear);if(!target)break;}
        window.__gameplayQA.aim(target.x,target.y,target.z-.002);
        if(mobile)window.__gameplayQA.touch(true,{x:target.x,y:target.y,z:target.z-.002});else window.__gameplayQA.press();
      }
      return{used,clear:complete(),coverage:wall.getChaseCoverage(point.definition.id),state:JSON.parse(game.renderState())};
    },{mobile,conduit});
    strikes+=result.used;
    if(result.clear){console.log(JSON.stringify({point:result.state.activePoint.id,mobile,conduit,strikes,clear:true}));return strikes;}
    if(!result.used)break;
    if(strikes%200===0)console.log(JSON.stringify({excavating:result.state.activePoint.id,mobile,conduit,strikes,coverage:result.coverage,removed:result.state.workSurface.removedVolumeCm3}));
  }
  await snap(page,`${mobile?'mobile':'desktop'}-excavation-failure`);
  throw Error(`Physical ${conduit?'PVC route':'box cavity'} never cleared after ${strikes} normal inputs: ${JSON.stringify(await state(page))}`);
}
async function mortarHold(page,mobile,held){
  if(mobile){
    let session=mortarTouchSessions.get(page);if(!session){session=await page.context().newCDPSession(page);mortarTouchSessions.set(page,session);}
    const r=await page.locator('#mortar-swing').boundingBox();
    assert(r,'Mortar touch hold control missing');
    await session.send('Input.dispatchTouchEvent',{type:held?'touchStart':'touchEnd',touchPoints:held?[{x:r.x+r.width/2,y:r.y+r.height/2,id:31}]:[]});
  }else await page.keyboard[held?'down':'up']('KeyE');
}
// This fixture changes only player placement/aim. The prediction reads the
// actual animated tip and public velocity model; hold/release launches the cast.
async function aimMortar(page,target,ballistic=false,near=false){
  return page.evaluate(({target,ballistic,near})=>{
    const game=window.__wireTheHouse,camera=game.renderer.camera;
    let predictedHit=null;
    camera.position.set(target.x+.055,game.player.eyeHeight,near?-1.92:-1.10);camera.lookAt(target.x,target.y,target.z);camera.updateMatrixWorld(true);
    game.player.yaw=camera.rotation.y;game.player.pitch=camera.rotation.x;game.step(0);
    if(ballistic){
      const best={error:Infinity,x:camera.rotation.x,y:camera.rotation.y};
      const rawPredict=()=>{
        game.player.yaw=camera.rotation.y;game.player.pitch=camera.rotation.x;game.step(0);camera.updateMatrixWorld(true);
        const o=game.fpsRig.toolTipWorld(camera,'trowel'),v=game.mortar.velocity(camera,game.mortar.charge),t=(target.z-o.z)/v.z,q=o.clone(),velocity=v.clone();
        for(let i=0;i<75;i++){const next=q.clone().addScaledVector(velocity,.02);next.y-=4.905*.02**2;const d=next.clone().sub(q),hit=game.mortar.contact(q,d.clone().normalize(),d.length());if(hit)return{x:hit.point.x,y:hit.point.y,t:i*.02};q.copy(next);velocity.y-=9.81*.02;if(q.y<0)break;}
        return{x:o.x+v.x*t,y:o.y+v.y*t-4.905*t*t,t};
      };
      const predict=()=>{const p=rawPredict(),error=Math.hypot(p.x-target.x,p.y-target.y);if(error<best.error){best.error=error;best.x=camera.rotation.x;best.y=camera.rotation.y;}return p;};
      for(let i=0;i<12;i++){
        const p=predict(),ex=target.x-p.x,ey=target.y-p.y;if(Math.hypot(ex,ey)<.0003)break;
        const step=.001,x=camera.rotation.x,y=camera.rotation.y;
        camera.rotation.x=x+step;const px=predict();camera.rotation.x=x;camera.rotation.y=y+step;const py=predict();camera.rotation.y=y;
        const a=(px.x-p.x)/step,b=(py.x-p.x)/step,c=(px.y-p.y)/step,d=(py.y-p.y)/step,det=a*d-b*c;if(Math.abs(det)<1e-6)break;
        camera.rotation.x+=Math.max(-.2,Math.min(.2,(ex*d-b*ey)/det));camera.rotation.y+=Math.max(-.2,Math.min(.2,(a*ey-ex*c)/det));
      }
      // First contact can switch between a rim and its deeper backing. Preserve
      // the best physical hit instead of accepting a divergent Newton iterate.
      for(const scale of [.18,.08,.025,.008,.0025]){const x=best.x,y=best.y;for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){camera.rotation.x=Math.max(-1.18,Math.min(1.18,x+dx*scale));camera.rotation.y=y+dy*scale;predict();}}
      camera.rotation.x=best.x;camera.rotation.y=best.y;
      const p=predict();predictedHit={x:p.x,y:p.y,error:Math.hypot(p.x-target.x,p.y-target.y)};
    }
    game.player.yaw=camera.rotation.y;game.player.pitch=camera.rotation.x;camera.updateMatrixWorld(true);
    return{charge:game.mortar.charge,angle:game.mortar.angleDegrees,predictedHit};
  },{target,ballistic,near});
}
async function dampenTargets(page,mobile,targets){
  for(const target of targets)for(let dose=0;dose<3;dose++){
    const support=await page.evaluate(target=>{const g=window.__wireTheHouse,o=g.renderer.camera.position.clone().set(target.x,target.y,g.room.brickWall.volume.frontZ+.08),hit=g.mortar.contact(o,o.clone().set(0,0,-1),.30);if(!hit)return null;const wet=g.mortar.moistureAt(hit.point);return{x:hit.point.x,y:hit.point.y,z:hit.point.z,pore:wet.pore,film:wet.film};},target);
    if(!support||support.pore>=.35||support.film>=.25)break;
    await aimMortar(page,support);await mortarHold(page,mobile,true);await page.evaluate(()=>window.advanceTime(150));await mortarHold(page,mobile,false);await page.evaluate(()=>window.advanceTime(34));
  }
}
async function applyMortar(page,mobile,repack=false){
  const before=await state(page);
  await select(page,'fitting',mobile);
  await action(page,mobile);assert((await state(page)).activePoint.stage==='fitted','Fitting tool still bypasses real mortar application');
  const targets=await page.evaluate(()=>{
    const p=window.__wireTheHouse.mission.activePoint,w=p.boxGroup.groupWidth/2+.026,h=p.boxGroup.groupHeight/2+.024,out=[];p.updateWorldMatrix(true,true);
    for(let side=0;side<4;side++)for(const t of [-.72,0,.72]){const q=p.position.clone().set(side<2?t*w:(side===2?-w:w),side<2?(side===0?-h:h):t*h,0);p.boxGroup.localToWorld(q);out.push({side,x:q.x,y:q.y,z:q.z});}
    return out;
  });
  await select(page,'hose',mobile);
  await dampenTargets(page,mobile,targets);
  const damp=await state(page);assert(damp.mortar.wetCells>0,'Hose inputs deposited no water');
  await select(page,'trowel',mobile);
  await assertLayout(page,mobile);
  const angle=(await state(page)).mortar.angleDegrees;
  if(mobile){await page.locator('#mortar-angle-up').tap();assert((await state(page)).mortar.angleDegrees===angle+5,'Touch throw angle failed');await page.locator('#mortar-angle-down').tap();}
  else{await page.keyboard.press('ArrowUp');assert((await state(page)).mortar.angleDegrees===angle+2,'Keyboard throw angle failed');await page.keyboard.press('ArrowDown');}
  let casts=0;
  for(let attempt=0;attempt<120&&(await state(page)).activePoint.stage==='fitted';attempt++){
    const target=!repack&&attempt<targets.length?targets[attempt]:await page.evaluate(side=>{
      const g=window.__wireTheHouse,p=g.mission.activePoint,m=g.mortar,w=p.boxGroup.groupWidth/2+.026,h=p.boxGroup.groupHeight/2+.024,missing=[];p.updateWorldMatrix(true,true);
      const meshes=m.deposits.filter(d=>d.age>=1.3).map(d=>d.mesh);for(const mesh of meshes)mesh.updateWorldMatrix(true,false);
      for(let i=0;i<12;i++){const t=-.9+1.8*i/11,q=p.position.clone().set(side<2?t*w:(side===2?-w:w),side<2?(side===0?-h:h):t*h,.024);p.boxGroup.localToWorld(q);const direction=q.clone().set(0,0,-1).transformDirection(p.boxGroup.matrixWorld);m.ray.set(q,direction);m.ray.near=0;m.ray.far=.065;if(!m.ray.intersectObjects(meshes,false).length)missing.push({side,x:q.x,y:q.y,z:q.z-.024});}
      return missing.length<=3?null:missing[Math.floor(missing.length/2)];
    },attempt%4);
    if(!target)continue;
    const support=await page.evaluate(({target,attempt})=>{
      const g=window.__wireTheHouse,o=g.renderer.camera.position.clone().set(target.x,target.y,g.room.brickWall.volume.frontZ+.08),d=o.clone().set(0,0,-1),hit=g.mortar.contact(o,d,.30);
      if(attempt>=12&&hit){
        const outward=target.side===0?[0,-1]:target.side===1?[0,1]:target.side===2?[-1,0]:[1,0];
        for(const offset of [.02,.03,.04]){const q=o.clone();q.x+=outward[0]*offset;q.y+=outward[1]*offset;const rim=g.mortar.contact(q,d,.30);if(rim&&!rim.box&&rim.normal.z>.6&&rim.point.z>hit.point.z+.015&&rim.point.z<=g.room.brickWall.volume.frontZ+.018)return{...target,x:rim.point.x,y:rim.point.y,z:rim.point.z,adjacentRim:true};}
      }
      return hit?{...target,x:hit.point.x,y:hit.point.y,z:hit.point.z}:target;
    },{target,attempt:repack?attempt+12:attempt});
    await aimMortar(page,support);await mortarHold(page,mobile,true);await page.evaluate(()=>window.advanceTime(550));
    const solved=await aimMortar(page,support,true);assert(solved.charge>.25,'Trowel hold did not charge');
    report.lastMortarAim={target:support,...solved};
    await mortarHold(page,mobile,false);
    const flight=await page.evaluate(target=>{window.advanceTime(17);const m=window.__wireTheHouse.mortar,c=m.projectiles.at(-1);if(!c)return null;const o=c.mesh.position,v=c.velocity,t=(target.z-o.z)/v.z;return{power:m.charge,origin:o.toArray(),velocity:v.toArray(),prediction:[o.x+v.x*t,o.y+v.y*t-4.905*t*t,target.z],target,contacts:c.contacts};},support);
    await page.evaluate(()=>window.advanceTime(1300));casts++;
    if(casts<=4)console.log(JSON.stringify({flight}));
    if((await state(page)).activePoint.stage==='fitted'){
      await aimMortar(page,support,false,true);
      if(mobile)await page.locator('#mortar-pack').tap();else await page.keyboard.press('KeyP');
      await page.evaluate(()=>window.advanceTime(800));
    }
    assert(!await page.evaluate(()=>window.__wireTheHouse.input.actionHeld),'Mortar release remained held');
    if(casts%4===0){
      report.lastMortarGeometry=await page.evaluate(()=>{const m=window.__wireTheHouse.mortar;return{patches:m.deposits.length,vertices:m.deposits.reduce((s,d)=>s+d.mesh.geometry.getAttribute('position').count,0),largestPatch:Math.max(0,...m.deposits.map(d=>d.mesh.geometry.getAttribute('position').count))};});
      console.log(JSON.stringify({mortarPoint:(await state(page)).activePoint.id,mobile,casts,geometry:report.lastMortarGeometry,mortar:(await state(page)).mortar}));
      report.lastMortarDeposits=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.activePoint;p.updateWorldMatrix(true,true);return g.mortar.deposits.map(d=>({local:p.boxGroup.worldToLocal(d.position.clone()).toArray(),mass:d.mass,normal:d.normal.toArray()}));});
      if(casts>=12)assert((await state(page)).mortar.stuckKg>before.mortar.stuckKg+.005,`No retained mortar after ${casts} physical casts; geometry=${JSON.stringify(report.lastMortarGeometry)}`);
    }
    if((await state(page)).activePoint.stage==='mortared')break;
  }
  const after=await state(page);assert(after.mortar.launchedKg>before.mortar.launchedKg&&after.mortar.stuckKg>before.mortar.stuckKg,'No actual ballistic mortar stuck');
  if(after.activePoint.stage!=='mortared'){
    report.mortarFailureGeometry=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.activePoint;p.updateWorldMatrix(true,true);return{boxPosition:p.position.toArray(),boxDepth:p.boxGroup.position.z,boxTilt:p.boxGroup.rotation.z,deposits:g.mortar.deposits.map(d=>({local:p.boxGroup.worldToLocal(d.position.clone()).toArray(),mass:d.mass,radius:d.radius,normal:d.normal.toArray()})),projectiles:g.mortar.projectiles.slice(0,5).map(c=>({position:c.mesh.position.toArray(),velocity:c.velocity.toArray(),age:c.age,contacts:c.contacts}))};});
  }
  assert(after.activePoint.stage==='mortared',`Four-sided mortar bed incomplete after ${casts} casts: ${JSON.stringify(after.mortar)}`);
  report.scenarios.push({platform:mobile?'mobile-emulated':'desktop',point:after.activePoint.id,mortarCasts:casts,repack,launchedKg:after.mortar.launchedKg-before.mortar.launchedKg,stuckKg:after.mortar.stuckKg-before.mortar.stuckKg});
  await snap(page,`${mobile?'mobile':'desktop'}-point-${after.activePoint.id}-${repack?'repacked':'mortar-casts'}`);
}
async function fitAndLevel(page,mobile){
  await select(page,'hose',mobile);
  const posture=await page.evaluate(()=>({low:window.__wireTheHouse.mission.activePoint.position.y<.8,crouched:window.__wireTheHouse.player.crouched}));
  if(posture.low!==posture.crouched){await page.locator('#work-height')[mobile?'tap':'click']();await page.evaluate(()=>window.advanceTime(500));}
  await select(page,'hose',mobile);await aimActive(page);await mortarHold(page,mobile,true);await page.evaluate(()=>window.advanceTime(400));await mortarHold(page,mobile,false);await page.evaluate(()=>window.advanceTime(34));
  const internalWet=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.activePoint;return [...g.mortar.water.values()].map(cell=>cell.position??cell.mesh?.position).filter(q=>q&&Math.abs(q.x-p.position.x)<p.boxGroup.groupWidth/2+.15&&Math.abs(q.y-p.position.y)<.2&&q.z<g.room.brickWall.volume.frontZ-.02).map(q=>q.z);});
  assert(internalWet.length>0,'Hose did not wet a real internal chase surface before box fitting');
  report.scenarios.push({platform:mobile?'mobile-emulated':'desktop',point:(await state(page)).activePoint.id,internalChaseWetZ:Math.min(...internalWet)});
  const prefitRing=await page.evaluate(()=>{const p=window.__wireTheHouse.mission.activePoint,w=p.boxGroup.groupWidth/2+.026,h=p.boxGroup.groupHeight/2+.024;return[-.7,0,.7].flatMap(t=>[{x:p.position.x+t*w,y:p.position.y-h,z:p.position.z},{x:p.position.x+t*w,y:p.position.y+h,z:p.position.z}]).concat([{x:p.position.x-w,y:p.position.y,z:p.position.z},{x:p.position.x+w,y:p.position.y,z:p.position.z}]);});
  await dampenTargets(page,mobile,prefitRing);
  await aimActive(page);await select(page,'fitting',mobile);await action(page,mobile);
  assert((await state(page)).activePoint.stage==='fitted','Clear boxes were not fitted');
  await applyMortar(page,mobile);
  for(let repackCycles=0;repackCycles<=3;repackCycles++){
    await aimActive(page);await select(page,'level',mobile);await action(page,mobile);assert((await state(page)).activePoint.stage==='leveling','Leveling did not open');
    await page.waitForTimeout(30);assert(!await page.evaluate(()=>Boolean(document.pointerLockElement)),'Leveling trapped pointer');
    const initial=(await state(page)).activePoint;
    if(!initial.levelPass||!initial.flushPass){
      await page.locator('[data-level="confirm"]')[mobile?'tap':'click']();await page.evaluate(()=>window.advanceTime(34));
      assert((await state(page)).activePoint.stage==='leveling','Unlevel boxes passed confirmation');
    }
    for(let i=0;i<16;i++){
      const current=(await state(page)).activePoint;if(current.levelPass&&current.flushPass)break;
      const direction=!current.levelPass?current.tiltDegrees>0?'left':'right':current.depthErrorMm>0?'in':'out';
      await page.locator(`[data-level="${direction}"]`)[mobile?'tap':'click']();await page.evaluate(()=>window.advanceTime(17));
    }
    const aligned=(await state(page)).activePoint;assert(aligned.levelPass&&aligned.flushPass,'Alignment controls failed');
    await snap(page,`${mobile?'mobile':'desktop'}-point-${aligned.id}-leveled${repackCycles?`-repack-${repackCycles}`:''}`);
    await page.locator('[data-level="confirm"]')[mobile?'tap':'click']();await page.evaluate(()=>window.advanceTime(34));
    const checked=await state(page);
    if(checked.activePoint.stage==='leveled'){
      const fraction=checked.mortar.coverage.find(p=>p.id===checked.activePoint.id).fraction;
      assert(fraction>=.68,'Leveling passed without continuous physical mortar support');
      report.scenarios.push({platform:mobile?'mobile-emulated':'desktop',point:checked.activePoint.id,repackCycles,finalBedCoverage:fraction,postLevelMortarVertices:await page.evaluate(()=>window.__wireTheHouse.mortar.deposits.reduce((s,d)=>s+d.mesh.geometry.getAttribute('position').count,0))});return;
    }
    assert(checked.activePoint.stage==='fitted'&&repackCycles<3,'Valid alignment failed after three physical repack cycles');
    assert(checked.activePoint.levelPass&&checked.activePoint.flushPass,'Repack request discarded aligned box transforms');
    await applyMortar(page,mobile,true);
  }
}
async function finishPipe(page,mobile){
  await aimActive(page);await select(page,'spring',mobile);await action(page,mobile);
  assert((await state(page)).activePoint.pipeStep==='cut','PVC measuring failed');
  await action(page,mobile);assert((await state(page)).activePoint.pipeStep==='cut','Spring incorrectly cut PVC');
  await select(page,'cutter',mobile);await action(page,mobile);assert((await state(page)).activePoint.pipeStep==='bend','PVC cutting failed');
  await select(page,'spring',mobile);await action(page,mobile);assert((await state(page)).activePoint.pipeStep==='install','Spring bend failed');
  const clear=await page.evaluate(()=>window.__wireTheHouse.room.brickWall.canFitConduit(window.__wireTheHouse.mission.activePoint));
  if(!clear){await action(page,mobile);assert((await state(page)).activePoint.pipeStep==='install','PVC installed through solid wall');await excavate(page,mobile,true);}
  await aimActive(page);await select(page,'spring',mobile);await action(page,mobile);
}
async function workedScenePerformance(page){
  return page.evaluate(async()=>{
    const game=window.__wireTheHouse;window.advanceTime(3000);await game.room.brickWall.waitForGeometry();
    const frames=[];let previous=await new Promise(requestAnimationFrame);
    for(let i=0;i<60;i++){const now=await new Promise(requestAnimationFrame);frames.push(now-previous);previous=now;}
    const sorted=[...frames].sort((a,b)=>a-b),info=game.renderer.webgl.info,m=game.mortar;
    return{samples:frames.length,meanFrameMs:frames.reduce((a,b)=>a+b,0)/frames.length,p95FrameMs:sorted[Math.floor(sorted.length*.95)],worstFrameMs:Math.max(...frames),renderCalls:info.render.calls,triangles:info.render.triangles,memory:{geometries:info.memory.geometries,textures:info.memory.textures},deposits:m.deposits.length,mortarVertices:m.deposits.reduce((s,d)=>s+d.mesh.geometry.getAttribute('position').count,0),restingBatches:m.telemetry.restingBatches,airborne:m.projectiles.length};
  });
}
async function assertResultTitle(page){
  const bounds=await page.evaluate(()=>{const heading=document.querySelector('#result-panel h2'),out=[];for(const node of heading.childNodes)if(node.nodeType===Node.TEXT_NODE&&node.textContent.trim()){const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();out.push({text:node.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom});}return{width:innerWidth,height:innerHeight,text:out};});
  assert(bounds.text.every(r=>r.left>=-1&&r.right<=bounds.width+1&&r.top>=-1&&r.bottom<=bounds.height+1),`Clipped completion heading: ${JSON.stringify(bounds)}`);return bounds;
}
try{
  const desktop=await createPage();report.desktopLayout=await assertLayout(desktop,false);
  const beforeMove=await state(desktop);await desktop.keyboard.down('KeyS');await desktop.evaluate(()=>window.advanceTime(400));await desktop.keyboard.up('KeyS');
  assert(Math.abs((await state(desktop)).player.z-beforeMove.player.z)>.3,'WASD failed');
  const yaw=(await state(desktop)).player.yaw;await desktop.mouse.move(690,380);await desktop.mouse.move(740,400);assert(Math.abs((await state(desktop)).player.yaw-yaw)>.01,'Mouse look failed');
  await select(desktop,'spray');await desktop.mouse.wheel(0,100);await desktop.evaluate(()=>window.advanceTime(17));assert((await state(desktop)).mission.selectedTool==='hammer','Wheel cycle failed');
  await desktop.evaluate(()=>document.exitPointerLock());await desktop.waitForTimeout(50);await desktop.locator('#settings-toggle').click();
  assert(await desktop.locator('#settings-panel').getAttribute('aria-hidden')==='false','Settings failed');await desktop.locator('#chisel-type').click();
  assert((await state(desktop)).workSurface.chisel==='pointed','Chisel selector failed');await desktop.locator('#chisel-type').click();await chiselControls(desktop,false);await desktop.locator('#settings-close').click();
  for(const id of ['A','B','C']){
    assert((await state(desktop)).activePoint.id===id,`Expected point ${id}`);await markPoint(desktop,false,id==='A');
    await select(desktop,'fitting');await aimActive(desktop);await action(desktop);assert((await state(desktop)).activePoint.stage==='marked','Uncut wall accepted boxes');
    const strokes=await excavate(desktop,false);await snap(desktop,`desktop-point-${id}-real-cavity`);
    await fitAndLevel(desktop,false);await finishPipe(desktop,false);assert((await state(desktop)).points.find(p=>p.id===id).stage==='complete',`Point ${id} incomplete`);
    report.scenarios.push({platform:'desktop',point:id,boxStrokes:strokes,complete:true});
  }
  assert((await state(desktop)).mission.complete,'Full mission incomplete');report.desktopWorkedScene=await workedScenePerformance(desktop);report.desktopResultTitle=await assertResultTitle(desktop);await snap(desktop,'desktop-first-fix-complete');await desktop.close();
  const mobile=await createPage(true);report.mobileLayout=await assertLayout(mobile,true);await snap(mobile,'mobile-entry');
  await mobile.locator('#settings-toggle').tap();assert(await mobile.locator('#settings-panel').getAttribute('aria-hidden')==='false','Mobile settings failed');await chiselControls(mobile,true);await mobile.locator('#settings-close').tap();
  for(const tool of ['spring','cutter','spray','hammer','fitting','level','trowel','hose'])await select(mobile,tool,true);
  const session=await mobile.context().newCDPSession(mobile),joy=await mobile.locator('#joystick').boundingBox(),sx=joy.x+joy.width/2,sy=joy.y+joy.height/2;
  const beforeTouch=await state(mobile);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy,id:1}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+30,y:sy,id:1}]});
  await mobile.evaluate(()=>window.advanceTime(400));await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert(Math.abs((await state(mobile)).player.x-beforeTouch.player.x)>.15,'Real touch joystick failed');
  await markPoint(mobile,true,true);await select(mobile,'hammer',true);await aimActive(mobile);
  const pad=await mobile.locator('#look-joystick').boundingBox(),x=pad.x+pad.width/2,y=pad.y+pad.height/2,beforeHold=await state(mobile);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:2}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+12,y,id:2}]});
  await aimActive(mobile);await mobile.evaluate(()=>window.advanceTime(800));await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert((await state(mobile)).workSurface.impactCount>beforeHold.workSurface.impactCount+1,'Real touch held chisel did not repeat');assert(!await mobile.evaluate(()=>window.__wireTheHouse.input.actionHeld),'Touch release stuck');
  await snap(mobile,'mobile-real-held-chisel');const strokes=await excavate(mobile,true);await fitAndLevel(mobile,true);await finishPipe(mobile,true);
  assert((await state(mobile)).points[0].stage==='complete','Mobile point workflow incomplete');report.scenarios.push({platform:'mobile-emulated',point:'A',boxStrokes:strokes,complete:true,realTouchHold:true});
  await snap(mobile,'mobile-point-A-complete');
  for(const id of ['B','C']){
    assert((await state(mobile)).activePoint.id===id,`Expected mobile point ${id}`);await markPoint(mobile,true);
    const strokes=await excavate(mobile,true);await fitAndLevel(mobile,true);await finishPipe(mobile,true);
    assert((await state(mobile)).points.find(p=>p.id===id).stage==='complete',`Mobile point ${id} incomplete`);
    report.scenarios.push({platform:'mobile-emulated',point:id,boxStrokes:strokes,complete:true});
  }
  assert((await state(mobile)).mission.complete,'Full mobile mission incomplete');report.mobileWorkedScene=await workedScenePerformance(mobile);report.mobileResultTitle=await assertResultTitle(mobile);await snap(mobile,'mobile-first-fix-complete');
  await mobile.close();assert(!errors.length,errors.join('\n'));console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=String(error.stack??error);report.failureStates=[];for(const context of browser.contexts())for(const page of context.pages()){try{report.failureStates.push(await state(page));await page.screenshot({path:join(output,'gameplay-failure.png')});}catch{}}throw error;}
finally{await writeFile(join(output,'gameplay-report.json'),JSON.stringify(report,null,2));await browser.close();}
