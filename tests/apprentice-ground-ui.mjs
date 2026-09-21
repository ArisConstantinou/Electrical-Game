import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';

await mkdir('output/apprentice/ground',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],errors:[],states:[]};
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await blockPointerLock(context);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  const start=async()=>{
    await page.goto('http://127.0.0.1:5365/Electrical-Game/');
    await page.waitForFunction(()=>window.__wireTheHouse,undefined,{timeout:120000});
    await page.locator('#start-button').tap();
    await page.waitForFunction(()=>window.__wireTheHouse.started);
    await page.waitForTimeout(250);
  };
  const aimFloor=async(x,z)=>page.evaluate(({x,z})=>{
    const g=window.__wireTheHouse,c=g.renderer.camera;
    c.position.set(-.9,1.65,1.6);c.lookAt(x,0,z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);
    const rect=g.renderer.webgl.domElement.getBoundingClientRect(),p=c.position.clone().set(x,0,z).project(c);
    const sx=rect.left+(p.x+1)*rect.width/2,sy=rect.top+(1-p.y)*rect.height/2;
    const element=document.elementFromPoint(sx,sy);
    return {x:sx,y:sy,hit:g.apprentice.groundAt(g.renderer.webgl.domElement,sx,sy)?.toArray(),target:element?.id,tag:element?.tagName,gameTarget:Boolean(element?.closest('#game-stage,#reticle'))};
  },{x,z});

  await start();
  const oldRect=await page.locator('#apprentice-controls').boundingBox();
  assert(oldRect.height<=62&&oldRect.y>=770,`apprentice commands are not in the bottom nav: ${JSON.stringify(oldRect)}`);
  const navStyle=await page.locator('#apprentice-controls').evaluate(node=>({background:getComputedStyle(node).backgroundColor,border:getComputedStyle(node).borderTopWidth}));
  assert.equal(navStyle.background,'rgba(0, 0, 0, 0)');assert.equal(navStyle.border,'0px');
  report.checks.push('icon commands occupy the bottom nav below the joysticks without a panel');
  if(!process.argv.includes('--boxes-only')){
  const floor=await aimFloor(.5,.05);
  assert(floor.hit&&floor.gameTarget,`floor touch unavailable: ${JSON.stringify(floor)}`);
  await page.touchscreen.tap(floor.x,floor.y);
  await page.waitForFunction(()=>window.__wireTheHouse.apprentice.phase==='directed',undefined,{timeout:4000});
  const moving=await page.evaluate(()=>({state:window.__wireTheHouse.apprentice.telemetry,route:window.__wireTheHouse.apprentice.groundRoute.visible,marker:window.__wireTheHouse.apprentice.groundMarker.visible}));
  assert(moving.route&&moving.marker,'destination arc and dashed route visible while walking');
  await page.screenshot({path:'output/apprentice/ground/tap-route.png'});
  await page.waitForFunction(()=>window.__wireTheHouse.apprentice.phase==='done',undefined,{timeout:12000});
  report.checks.push('tap on floor gives visible routed walking order');report.states.push({tap:moving.state});

  const cdp=await context.newCDPSession(page);
  const hold=await aimFloor(1.65,.45);
  assert(hold.hit&&hold.gameTarget,`hold point unavailable: ${JSON.stringify(hold)}`);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hold.x,y:hold.y,id:11}]});
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#apprentice-ground-menu').isVisible(),true,'long press opens contextual commands');
  assert.equal(await page.locator('#apprentice-ground-menu').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)','ground commands must have no panel');
  await page.screenshot({path:'output/apprentice/ground/hold-menu.png'});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.phase),'done','long press does not issue tap movement');
  await page.locator('[data-ground="mix"]').tap();
  await page.waitForFunction(()=>window.__wireTheHouse.apprentice.phase==='directed',undefined,{timeout:4000});
  await page.waitForFunction(()=>window.__wireTheHouse.apprentice.phase==='construction',undefined,{timeout:12000});
  const mix=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
  assert(['claim','return-hammer','water-source'].includes(mix.workStep),`mixing did not start: ${mix.workStep}`);report.checks.push('long press menu assigns standalone physical mixing after arrival');report.states.push({mix});
  // Keep the player out of the station aisle while the Apprentice carries material.
  await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.set(2.8,1.65,-1.45));
  await page.evaluate(()=>{const game=window.__wireTheHouse;window.groundStep=game.step.bind(game);game.step=()=>{};});
  let lastMixStage='';
  for(let attempt=0;attempt<700;attempt++){
    await page.evaluate(()=>{for(let frame=0;frame<48;frame++)window.groundStep(1/60);});
    const state=await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry);
    const stage=`${state.phase}:${state.workStep??''}:${state.batchCycle}`;
    if(stage!==lastMixStage){lastMixStage=stage;report.states.push({mixStage:stage,attempt,cement:state.cementDone,sand:state.sandDone,cart:await page.evaluate(()=>window.__wireTheHouse.mixing.wheelbarrow.massKg)});}
    if(state.phase==='blocked')throw new Error(`standalone mixing blocked: ${state.message}`);
    if(state.phase==='done')break;
    if(state.batchCycle===0&&state.workStep==='cement-source'&&state.cementDone>=3&&state.cementDone<17){
      await page.evaluate(()=>{const game=window.__wireTheHouse;while(game.apprentice.cementDone<17){const sack=game.mixing.batch.getState().sacks.findIndex(item=>item.remainingKg>.5);if(!game.mixing.batch.getState().sacks[sack].open)game.mixing.batch.openSack(sack);if(!game.mixing.batch.scoopCement(sack)||!game.mixing.batch.pour('trowel',game.mixing.drum.batch))throw Error('cement deposit failed');game.apprentice.cementDone++;}});
    }
    if(state.batchCycle===0&&state.workStep==='sand-source'&&state.sandDone>=3&&state.sandDone<35){
      await page.evaluate(()=>{const game=window.__wireTheHouse;while(game.apprentice.sandDone<35){if(!game.mixing.batch.scoopSand()||!game.mixing.batch.pour('shovel',game.mixing.drum.batch))throw Error('sand deposit failed');game.apprentice.sandDone++;}});
    }
  }
  const completeMix=await page.evaluate(()=>({phase:window.__wireTheHouse.apprentice.phase,cart:window.__wireTheHouse.mixing.wheelbarrow.massKg,capacity:window.__wireTheHouse.mixing.wheelbarrow.capacityKg}));
  assert.equal(completeMix.phase,'done',`standalone mixing must finish; last stage ${lastMixStage}, cart ${completeMix.cart}`);
  assert(completeMix.cart>0&&completeMix.cart<=completeMix.capacity,'real mortar must be deposited in the cart');
  report.checks.push('standalone mixing completes with real retained cart mass');report.states.push({completeMix});
  }

  await start();
  await page.evaluate(()=>{
    const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(0,1.65,.2);c.lookAt(.4,1.15,-2.41);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);
  });
  await page.locator('[data-apprentice="layout"]').tap();
  await page.waitForFunction(()=>window.__wireTheHouse.apprentice.mode==='layout',undefined,{timeout:4000});
  await page.waitForFunction(()=>window.__wireTheHouse.apprentice.ghost.visible,undefined,{timeout:4000});
  const box=await page.evaluate(()=>({anchor:window.__wireTheHouse.apprentice.anchor?.toArray(),mode:window.__wireTheHouse.apprentice.mode,ghost:window.__wireTheHouse.apprentice.ghost.visible}));
  assert(box.anchor&&box.ghost,'BOXES button opens a live anchored preview without earlier marking');
  await page.screenshot({path:'output/apprentice/ground/boxes-open.png'});
  report.checks.push('BOXES opens wall preview directly from aimed wall');report.states.push({box});
  assert.deepEqual(report.errors,[]);
}finally{await writeFile('output/apprentice/ground/ui-report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,completeMix:report.states.find(state=>state.completeMix)?.completeMix}));
