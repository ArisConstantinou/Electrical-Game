import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const out = process.argv[3] ?? 'output/mortar-mixing-ui';
await mkdir(out, {recursive:true});
const report = {
  url, taskBuildRoot:process.env.TASK_BUILD_ROOT??null, mobileIsEmulation:true,
  method:'Actual click/touch ingredient pickup, pouring and batch discard; mixer hold/release; bucket carry/place; and native mortar throw. Camera placement/aim, deterministic game stepping and a dispatched window blur are fixtures; no batch is populated by a fixture. Negative and inserted-engine E-key checks also run on the emulated mobile pages; successful mobile preparation, carry/drop and throw use touch. Normal tool-action instrumentation delegates unchanged. Pointer Lock is disabled before navigation and all browser contexts are closed.',
  cases:[], errors:[],
};
const browser = await chromium.launch({channel:'chrome', headless:true});
let activePage;
const layouts = [
  {name:'desktop', width:1366, height:768, mobile:false},
  {name:'portrait', width:390, height:844, mobile:true},
  {name:'landscape', width:844, height:390, mobile:true},
];
const steps = (page, count=1) => page.evaluate(n => {
  for(let i=0;i<n;i++) window.__mixStep(1/60);
}, count);
const screenshot = async (page, name) => {
  await page.evaluate(async () => {
    const renderer=window.__wireTheHouse.renderer;
    await renderer.waitForFrame(); renderer.render(); await renderer.waitForFrame();
  });
  await page.screenshot({path:`${out}/${name}.png`});
};
const layoutState = page => page.evaluate(() => {
  const panel=document.querySelector('#mixing-panel');
  const visible=e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
  const box=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
  return {
    viewport:[innerWidth,innerHeight], overflow:document.documentElement.scrollWidth>innerWidth,
    panel:box(panel), pointerLock:document.pointerLockElement?.id??null,
    renderError:window.__wireTheHouse.renderer.renderError,
    text:[...panel.querySelectorAll('button,label,p,small,span,summary')].filter(visible).filter(e=>e.textContent.trim()).map(e=>({text:e.textContent.trim(),font:parseFloat(getComputedStyle(e).fontSize)})),
    controls:[...panel.querySelectorAll('button,input,select')].filter(visible).map(e=>({id:e.id,action:e.dataset.mixAction,tool:e.dataset.mixTool,...box(e)})),
  };
});
const state = page => page.evaluate(() => {
  const g=window.__wireTheHouse,m=g.mixing;
  return {
    batch:m.batch.getState(), active:m.active, carrying:m.carrying,
    customSupply:m.customSupply, mixerDirty:m.mixerDirty,
    inserted:m.inserted, bucketPosition:m.telemetry.bucketPosition,
    camera:g.renderer.camera.position.toArray(), selectedTool:g.selectedTool,
    mortar:{...g.mortar.telemetry}, renderError:g.renderer.renderError,
  };
});
const conserved = batch => {
  const stock=batch.sacks.reduce((sum,sack)=>sum+sack.remainingKg,0)+batch.sandRemainingKg;
  const held=(batch.heldTrowel?.kg??0)+(batch.heldShovel?.kg??0);
  assert(Math.abs(stock+held+batch.massKg+batch.consumedKg+batch.discardedKg-batch.initialStockKg-batch.addedWaterLitres)<1e-7,'Finite stocks, held tools, bucket, discarded and consumed mortar must conserve mass');
};

try {
  for(const layout of layouts) {
    if(process.env.QA_PLATFORM&&process.env.QA_PLATFORM!==layout.name)continue;
    const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:layout.mobile,hasTouch:layout.mobile});
    await blockPointerLock(context);
    await serveTaskBuild(context,url);
    const page=await context.newPage();
    activePage=page;
    await page.routeWebSocket('**',()=>{});
    page.on('pageerror',error=>report.errors.push({platform:layout.name,message:error.message}));
    page.on('console',message=>{if(message.type()==='error')report.errors.push({platform:layout.name,message:message.text()});});
    const click=async selector=>{
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.locator(selector)[layout.mobile?'tap':'click']();
      await steps(page,1);
    };
    await page.goto(url);
    await page.waitForFunction(()=>window.__wireTheHouse?.mixing,null,{timeout:120000});
    await page.locator('#start-button')[layout.mobile?'tap':'click']();
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__mixStep=g.step.bind(g);g.step=()=>{};});
    await steps(page,1);
    const scenario={platform:layout.name}; report.cases.push(scenario);
    const stationView=()=>page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,p=g.mixing.models.group.getWorldPosition(c.position.clone());c.position.set(p.x,g.player.eyeHeight,p.z-.9);c.lookAt(p.x,.4,p.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
    await stationView();await steps(page,1);
    if(layout.mobile)await page.locator('#mobile-interact').tap();else await page.keyboard.press('KeyE');
    await steps(page,1);
    await page.waitForTimeout(700);
    await screenshot(page,`${layout.name}-station-empty`);
    scenario.layout=await layoutState(page);
    assert.equal(scenario.layout.overflow,false,'Mixing UI must not overflow the viewport');
    assert.equal(scenario.layout.pointerLock,null);
    assert.equal(scenario.layout.renderError,'');
    assert(scenario.layout.panel.x>=0&&scenario.layout.panel.right<=layout.width+.5,'Panel must fit viewport width');
    assert(scenario.layout.panel.y>=0&&scenario.layout.panel.bottom<=layout.height+.5,'Panel must fit viewport height');
    for(const text of scenario.layout.text)assert(text.font>=12,`Text below 12 px: ${text.text}`);
    await stationView();
    await steps(page,1);
    assert.equal((await state(page)).batch.massKg,0,'Station begins with an empty finite bucket');
    await click('[data-mix-tool="water"]');
    await page.locator('#mixing-water-step').fill('10');
    await click('[data-mix-action="water"]');await click('[data-mix-action="water"]');
    const fullWater=(await state(page)).batch;
    assert.equal(fullWater.waterLitres,20);assert.equal(fullWater.ready,false);
    await click('[data-mix-action="water"]');
    assert.deepEqual((await state(page)).batch,fullWater,'A water-only full bucket refuses overflow without losing water');
    await click('#mixing-panel summary');
    await click('[data-mix-action="discard"]');
    scenario.discard=await state(page);
    assert.equal(scenario.discard.batch.massKg,0,'Player can empty an unusable water-only batch');
    assert.equal(scenario.discard.batch.discardedKg,20,'The discarded water remains in the mass ledger');
    conserved(scenario.discard.batch);
    await click('#mixing-panel summary');
    await page.locator('#mixing-water-step').fill('1');
    for(let i=0;i<6;i++)await click('[data-mix-action="water"]');
    await page.locator('#mixing-water-step').fill('0.5');
    await click('[data-mix-action="water"]');
    assert.equal((await state(page)).batch.waterLitres,6.5,'Player chooses water quantity through the UI');
    await click('[data-mix-tool="trowel"]');
    for(let sack=0;sack<3;sack++) {
      await page.locator('#mixing-sack').selectOption(String(sack));
      await click('[data-mix-action="cement"]');
      let s=await state(page);
      assert.equal(s.batch.sacks[sack].open,true,'Trowel opens each selected sealed sack');
      assert.equal(s.batch.heldTrowel,null,'Opening a sack is a separate action from scooping');
      for(let scoop=0;scoop<2;scoop++) {
        await click('[data-mix-action="cement"]');
        s=await state(page);
        assert.equal(s.batch.heldTrowel?.ingredient,'cement','Cement remains on the actual held trowel before pouring');
        if(sack===0&&scoop===0) {
          const load=s.batch.heldTrowel;
          await click('[data-mix-tool="shovel"]');
          await click('[data-mix-tool="trowel"]');
          assert.deepEqual((await state(page)).batch.heldTrowel,load,'Tool changes retain the loaded trowel');
        }
        await click('[data-mix-action="pour"]');
        s=await state(page); conserved(s.batch);
        assert.equal(s.batch.heldTrowel,null,'Pour transfers the trowel payload to the bucket');
      }
    }
    assert(Math.abs((await state(page)).batch.cementScoops-6)<1e-8);
    await click('[data-mix-tool="shovel"]');
    for(let scoop=0;scoop<12;scoop++) {
      await click('[data-mix-action="sand"]');
      assert.equal((await state(page)).batch.heldShovel?.ingredient,'sand');
      await click('[data-mix-action="pour"]');
      conserved((await state(page)).batch);
    }
    scenario.recipe=await state(page);
    assert(Math.abs(scenario.recipe.batch.sandScoops-12)<1e-8);
    assert.equal(scenario.recipe.batch.quality,'unmixed');
    assert(scenario.recipe.batch.volumeLitres>19&&scenario.recipe.batch.volumeLitres<=20);
    await screenshot(page,`${layout.name}-ingredients-loaded`);
    await click('[data-mix-action="sand"]');
    const beforeOverflow=(await state(page)).batch;
    await click('[data-mix-action="pour"]');
    assert.deepEqual((await state(page)).batch,beforeOverflow,'Overfilling rejects the pour and keeps all sand on the shovel');
    await click('[data-mix-tool="mixer"]');
    await stationView();
    await steps(page,1);
    await click('[data-mix-action="insert"]');
    const cdp=layout.mobile?await context.newCDPSession(page):null;
    const hold=async (selector,down) => {
      if(down)await page.locator(selector).scrollIntoViewIfNeeded();
      const b=await page.locator(selector).boundingBox();
      assert(b,`${selector} must be visible for native hold`);
      const point={x:b.x+b.width/2,y:b.y+b.height/2,id:29};
      if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[point]:[]});
      else {if(down)await page.mouse.move(point.x,point.y);await page.mouse[down?'down':'up']();}
    };
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,p=g.mixing.models.mixer.getWorldPosition(c.position.clone());window.__mixEngineView={yaw:g.player.yaw,pitch:g.player.pitch};c.lookAt(p.x,p.y+.75,p.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
    await steps(page,1);
    await page.keyboard.down('KeyE');await steps(page,30);await page.keyboard.up('KeyE');await steps(page,1);
    scenario.nativeEngine=await state(page);
    assert(scenario.nativeEngine.batch.mixProgress>.05&&scenario.nativeEngine.batch.mixProgress<.1,'Native E aimed at the inserted engine sustains actual mixing');
    assert.equal(scenario.nativeEngine.inserted,true,'Using the already inserted engine keeps it inserted');
    await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.yaw=window.__mixEngineView.yaw;g.player.pitch=window.__mixEngineView.pitch;});
    await steps(page,1);
    await click('#mixing-toggle');
    assert.equal(await page.locator('#mixing-panel').isHidden(),true,'The panel can collapse for an unobstructed view');
    assert.equal((await state(page)).active,true,'Collapsing the panel keeps station controls active');
    if(cdp)await hold('#mobile-interact',true);else await page.keyboard.down('KeyE');
    await steps(page,30);
    scenario.clearView=await state(page);
    assert(scenario.clearView.batch.mixProgress>scenario.nativeEngine.batch.mixProgress+.05,'Native USE/E continues mixing with the panel collapsed');
    assert.equal(scenario.clearView.active,true);
    await screenshot(page,`${layout.name}-mixing-clear-view`);
    if(cdp)await hold('#mobile-interact',false);else await page.keyboard.up('KeyE');
    await steps(page,1);
    await click('#mixing-toggle');
    assert.equal(await page.locator('#mixing-panel').isHidden(),false,'The player can reopen the recipe controls without leaving the station');
    await hold('#mixing-hold',true);await steps(page,120);await hold('#mixing-hold',false);
    scenario.partial=await state(page);
    assert(scenario.partial.batch.mixProgress>.2&&scenario.partial.batch.mixProgress<.4,'A short actual hold partially mixes');
    assert(Math.abs(scenario.partial.batch.mixProgress-scenario.clearView.batch.mixProgress-.25)<1e-8,'The explicit two-second hold adds exactly two seconds after native mixing');
    await steps(page,60);
    assert.equal((await state(page)).batch.mixProgress,scenario.partial.batch.mixProgress,'Releasing the mixer pauses progress');
    await hold('#mixing-hold',true);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await steps(page,60);await hold('#mixing-hold',false);
    assert.equal((await state(page)).batch.mixProgress,scenario.partial.batch.mixProgress,'Window blur cancels a held mixer');
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__mixView={position:g.renderer.camera.position.toArray(),yaw:g.player.yaw,pitch:g.player.pitch};g.player.yaw+=Math.PI;});
    await steps(page,1);
    await page.keyboard.down('KeyE');await steps(page,90);await page.keyboard.up('KeyE');
    assert.equal((await state(page)).batch.mixProgress,scenario.partial.batch.mixProgress,'Native E off target cannot mix behind the player');
    await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.set(2.1,g.player.eyeHeight,1.8);g.player.yaw=window.__mixView.yaw;g.player.pitch=window.__mixView.pitch;});
    await hold('#mixing-hold',true);await steps(page,90);await hold('#mixing-hold',false);
    assert.equal((await state(page)).batch.mixProgress,scenario.partial.batch.mixProgress,'Even the explicit mixer control cannot work outside physical reach');
    await page.evaluate(()=>{const g=window.__wireTheHouse;g.renderer.camera.position.fromArray(window.__mixView.position);g.player.yaw=window.__mixView.yaw;g.player.pitch=window.__mixView.pitch;});
    await steps(page,1);
    await hold('#mixing-hold',true);await steps(page,420);await hold('#mixing-hold',false);
    scenario.finished=await state(page);
    assert.equal(scenario.finished.batch.ready,true);
    assert.equal(scenario.finished.batch.quality,'balanced');
    assert.equal(scenario.finished.mixerDirty,true);
    conserved(scenario.finished.batch);
    await screenshot(page,`${layout.name}-mixed-ready`);
    await click('[data-mix-action="insert"]');
    await click('[data-mix-action="rinse"]');
    await steps(page,60);
    scenario.rinse=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,V=g.renderer.camera.position.constructor;return{tip:m.models.mixer.localToWorld(new V().fromArray(m.models.mixer.userData.tipPoint)).toArray(),pail:m.models.rinse.getWorldPosition(new V()).toArray(),seconds:m.telemetry.cleaningSeconds,dirty:m.mixerDirty};});
    assert(scenario.rinse.dirty&&scenario.rinse.seconds>0,'Rinsing takes actual simulation time');
    assert(Math.hypot(scenario.rinse.tip[0]-scenario.rinse.pail[0],scenario.rinse.tip[2]-scenario.rinse.pail[2])<.13,'Rinsing places the real paddle inside the water pail');
    assert(scenario.rinse.tip[1]-scenario.rinse.pail[1]>0&&scenario.rinse.tip[1]-scenario.rinse.pail[1]<.24,'Rinsing submerges the paddle tip in the pail');
    await screenshot(page,`${layout.name}-rinsing`);
    await steps(page,65);
    assert.equal((await state(page)).mixerDirty,false,'Player cleans the withdrawn mixer');
    await click('[data-mix-tool="hands"]');
    await click('[data-mix-action="carry"]');
    scenario.carryStart=await state(page);
    assert.equal(scenario.carryStart.carrying,true);
    await click('#mixing-toggle');
    await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.yaw=0;g.player.pitch=-.5;});
    if(cdp) {
      const pad=await page.locator('#joystick').boundingBox();
      const point={x:pad.x+pad.width/2,y:pad.y+pad.height/2,id:30};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:pad.y+5}]});
    } else await page.keyboard.down('KeyW');
    await page.evaluate(()=>{const g=window.__wireTheHouse;for(let i=0;i<150&&g.renderer.camera.position.z> -1.1;i++)window.__mixStep(1/60);});
    if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    else await page.keyboard.up('KeyW');
    scenario.carryEnd=await state(page);
    assert(scenario.carryStart.camera[2]-scenario.carryEnd.camera[2]>1.0,'Native walking moves the carried bucket across the room');
    assert(Math.hypot(scenario.carryEnd.camera[0]-scenario.carryEnd.bucketPosition[0],scenario.carryEnd.camera[2]-scenario.carryEnd.bucketPosition[2])<.8,'The actual bucket model follows the walking player');
    assert(scenario.carryEnd.bucketPosition[1]>.3,'Carried bucket is held above the floor');
    assert.equal(scenario.carryEnd.batch.massKg,scenario.finished.batch.massKg,'Transport preserves all mortar');
    await screenshot(page,`${layout.name}-carrying`);
    await page.evaluate(()=>{const g=window.__wireTheHouse;window.__mixDropActions=0;window.__mixPerformAction=g.performAction;g.performAction=function(...args){window.__mixDropActions++;return window.__mixPerformAction.apply(this,args);};});
    if(cdp)await hold('#mobile-interact',true);else await page.keyboard.down('KeyE');
    await steps(page,1);
    scenario.dropInput=await page.evaluate(()=>({carrying:window.__wireTheHouse.mixing.carrying,normalActions:window.__mixDropActions,held:window.__wireTheHouse.input.actionHeld,requested:window.__wireTheHouse.input.actionRequested}));
    if(cdp)await hold('#mobile-interact',false);else await page.keyboard.up('KeyE');
    await steps(page,1);
    assert.equal(scenario.dropInput.carrying,false,'Native E/USE places the bucket while the panel is closed');
    assert.equal(scenario.dropInput.normalActions,0,'The same drop press cannot also activate the normal selected tool');
    assert.equal(scenario.dropInput.held,false,'Dropping clears the held action before returning control to the normal tool');
    await page.evaluate(()=>{window.__wireTheHouse.performAction=window.__mixPerformAction;});
    await click('#mixing-toggle');
    assert.equal((await state(page)).carrying,false,'Player places the carried bucket on free floor');
    assert(Math.abs((await state(page)).bucketPosition[1])<1e-8,'Placed bucket rests on the floor');
    await click('[data-mix-action="work"]');
    assert.equal((await state(page)).selectedTool,'trowel');
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(2.1,g.player.eyeHeight,1.8);c.lookAt(2.1,1.4,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
    await steps(page,30);
    const away=await state(page);
    await page.keyboard.down('KeyE');await steps(page,28);await page.keyboard.up('KeyE');await steps(page,110);
    assert.equal((await state(page)).batch.consumedKg,away.batch.consumedKg,'Walking away from the placed bucket prevents remote refill');
    assert.equal((await state(page)).mortar.launchedKg,away.mortar.launchedKg,'No free scoop launches outside bucket reach');
    await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.1,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.85);c.lookAt(.1,1.4,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
    await steps(page,30);
    const beforeThrow=await state(page);
    if(cdp)await hold('#look-joystick',true);else await page.keyboard.down('KeyE');
    await steps(page,28);
    if(cdp)await hold('#look-joystick',false);else await page.keyboard.up('KeyE');
    await steps(page,110);
    scenario.throw=await state(page);
    const launched=scenario.throw.mortar.launchedKg-beforeThrow.mortar.launchedKg;
    const consumed=scenario.throw.batch.consumedKg-beforeThrow.batch.consumedKg;
    assert(launched>0,'Native hold/release launches actual mortar from the own batch');
    assert(scenario.throw.mortar.stuckKg>beforeThrow.mortar.stuckKg,'The own mortar reaches and sticks to actual masonry');
    assert(Math.abs(launched-consumed)<1e-8,'Launched mortar equals the exact own-bucket mass consumed');
    conserved(scenario.throw.batch);
    await screenshot(page,`${layout.name}-own-mortar-thrown`);
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.passed=true;
} catch(error) {
  report.failure=String(error.stack??error);
  if(activePage&&!activePage.isClosed()) {
    report.failedState=await state(activePage).catch(()=>null);
    await activePage.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  }
  throw error;
} finally {
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify({report:`${out}/report.json`,platforms:report.cases.map(s=>s.platform),passed:report.passed}));
