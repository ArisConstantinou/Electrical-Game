import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const output = resolve(process.argv[3] ?? 'output/qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const report = { url: baseUrl, browser: browser.version(), mobileIsEmulation: true, scenarios: [], errors };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
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
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#start-button')[mobile ? 'tap' : 'click']();
  await page.waitForTimeout(150);
  // Fixtures position the player and aim. Wall state and mission stages are
  // never mutated: Input -> Game -> InteractionSystem handles every action.
  await page.evaluate(() => {
    window.__gameplayQA = {
      aim(x, y, z = -2.41) {
        const game = window.__wireTheHouse;
        game.renderer.camera.position.set(x, 1.65, -1.0);
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
  const keys = { spring: 'Digit1', cutter: 'Digit2', spray: 'Digit3', hammer: 'Digit4', fitting: 'Digit5', level: 'Digit6' };
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
async function fitAndLevel(page,mobile){
  await aimActive(page);await select(page,'fitting',mobile);await action(page,mobile);
  assert((await state(page)).activePoint.stage==='fitted','Clear boxes were not fitted');
  await action(page,mobile);assert((await state(page)).activePoint.stage==='mortared','Mortar failed');
  await select(page,'level',mobile);await action(page,mobile);assert((await state(page)).activePoint.stage==='leveling','Leveling did not open');
  await page.waitForTimeout(30);assert(!await page.evaluate(()=>Boolean(document.pointerLockElement)),'Leveling trapped pointer');
  await page.locator('[data-level="confirm"]')[mobile?'tap':'click']();await page.evaluate(()=>window.advanceTime(34));
  assert((await state(page)).activePoint.stage==='leveling','Unlevel boxes passed confirmation');
  for(let i=0;i<16;i++){
    const current=(await state(page)).activePoint;if(current.levelPass&&current.flushPass)break;
    const direction=!current.levelPass?current.tiltDegrees>0?'left':'right':current.depthErrorMm>0?'in':'out';
    await page.locator(`[data-level="${direction}"]`)[mobile?'tap':'click']();await page.evaluate(()=>window.advanceTime(17));
  }
  const aligned=(await state(page)).activePoint;assert(aligned.levelPass&&aligned.flushPass,'Alignment controls failed');
  await snap(page,`${mobile?'mobile':'desktop'}-point-${aligned.id}-leveled`);
  await page.locator('[data-level="confirm"]')[mobile?'tap':'click']();await page.evaluate(()=>window.advanceTime(34));
  assert((await state(page)).activePoint.stage==='leveled','Valid leveling rejected');
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
  assert((await state(desktop)).mission.complete,'Full mission incomplete');await snap(desktop,'desktop-first-fix-complete');await desktop.close();
  const mobile=await createPage(true);report.mobileLayout=await assertLayout(mobile,true);await snap(mobile,'mobile-entry');
  await mobile.locator('#settings-toggle').tap();assert(await mobile.locator('#settings-panel').getAttribute('aria-hidden')==='false','Mobile settings failed');await chiselControls(mobile,true);await mobile.locator('#settings-close').tap();
  for(const tool of ['spring','cutter','spray','hammer','fitting','level'])await select(mobile,tool,true);
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
  await snap(mobile,'mobile-point-A-complete');await mobile.close();assert(!errors.length,errors.join('\n'));console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=String(error.stack??error);report.failureStates=[];for(const context of browser.contexts())for(const page of context.pages()){try{report.failureStates.push(await state(page));await page.screenshot({path:join(output,'gameplay-failure.png')});}catch{}}throw error;}
finally{await writeFile(join(output,'gameplay-report.json'),JSON.stringify(report,null,2));await browser.close();}
