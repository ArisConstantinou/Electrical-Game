import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const mobile = process.argv.includes('--mobile');
const live = process.argv.includes('--live');
const dist = resolve('dist');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await blockPointerLock(context);
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
  if (!live) await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!file.startsWith(`${dist}\\`)) return route.abort();
    try { if (!(await stat(file)).isFile()) return route.abort(); await route.fulfill({ status:200, contentType:mime[extname(file)] ?? 'application/octet-stream', body:await readFile(file) }); }
    catch { await route.abort(); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(live ? 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl' : 'https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout:120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  const out = resolve(mobile ? 'output/mansion-masonry-chase/mobile' : 'output/mansion-masonry-chase/desktop');
  await mkdir(out, { recursive:true });
  const setup = await page.evaluate(() => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    game.step = () => {};
    camera.position.set(15.3,1.65,14.4); camera.rotation.set(0,Math.PI,0);
    game.selectedTool = 'hammer'; game.hammerMode = 'chase'; game.fpsRig.show('hammer');
    game.fpsRig.visible = false;
    game.renderer.render();
    return { target:game.room.mansionWing.aimMasonry(camera)?.wall.group.name, hammerMode:game.hammerMode };
  });
  const baselineTurnFrames = mobile ? await page.evaluate(async () => {
    const game=window.__wireTheHouse,camera=game.renderer.camera,intervals=[],renderMs=[];
    let previous=performance.now();
    for(let frame=0;frame<120;frame++){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const now=performance.now();if(frame>=30)intervals.push(now-previous);previous=now;
      camera.rotation.set(0,Math.PI+Math.sin(frame*.09)*.55,0);
      const started=performance.now();game.renderer.render();await game.renderer.waitForFrame();
      if(frame>=30)renderMs.push(performance.now()-started);
    }
    camera.rotation.set(0,Math.PI,0);game.renderer.render();
    intervals.sort((a,b)=>a-b);renderMs.sort((a,b)=>a-b);
    return {p95Ms:intervals[Math.floor(intervals.length*.95)],renderP95Ms:renderMs[Math.floor(renderMs.length*.95)],drawCalls:game.renderer.webgl.info.render.calls,triangles:game.renderer.webgl.info.render.triangles};
  }) : null;
  await page.locator('#game-canvas').screenshot({ path:resolve(out,'before.png') });
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    const wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    camera.position.set(15.3,1.65,15.0); camera.rotation.set(0,Math.PI,0);
    const first = game.room.mansionWing.aimMasonry(camera);
    const contact = first ? game.fpsRig.contactMasonry(camera,first.point) : false;
    if (contact) game.performAction();
    const phaseMs = { impact:[], mesh:[], joint:[] };
    const wrapVolume = volume => { const original=volume.impact.bind(volume); volume.impact=(...args)=>{const t=performance.now(),result=original(...args);phaseMs.impact.push(performance.now()-t);return result;}; };
    for (const entry of wall.broken.values()) wrapVolume(entry.volume);
    const create=wall.createBrokenBrick.bind(wall);wall.createBrokenBrick=(...args)=>{const entry=create(...args);wrapVolume(entry.volume);return entry;};
    const show=wall.showBrokenBrick.bind(wall);wall.showBrokenBrick=(...args)=>{const t=performance.now(),result=show(...args);phaseMs.mesh.push(performance.now()-t);return result;};
    const fracture=wall.fractureAcrossJoint.bind(wall);wall.fractureAcrossJoint=(...args)=>{const t=performance.now(),result=fracture(...args);phaseMs.joint.push(performance.now()-t);return result;};
    const strikeMs = [];
    for (const y of [1.85,1.79,1.73,1.67,1.61,1.55,1.49,1.43,1.37,1.31,1.25])
      for (const x of [15.27,15.30,15.33]) {
        camera.position.set(x,y,15.0); camera.rotation.set(0,Math.PI,0);
        for (let hit=0;hit<3;hit++) {
          const target = game.room.mansionWing.aimMasonry(camera);
          if (!target || target.wall !== wall) continue;
          const started=performance.now(); wall.strikeAt(target.index,camera,'chase'); strikeMs.push(performance.now()-started);
        }
      }
    const damage = wall.damageSnapshot();
    let shallow = true, deepest = 0;
    for (const item of damage) {
      const volume = wall.broken.get(item.index)?.volume;
      if (!volume) continue;
      for (const chunk of item.save.chunks) {
        const [tx,ty] = chunk.key.split(',').map(Number);
        for (const [offset,,removed] of chunk.edits) {
          if (!removed) continue;
          const z = offset % (volume.nz+2), xy = Math.floor(offset/(volume.nz+2));
          const x = tx*volume.tileSize + xy%volume.tileSize, y = ty*volume.tileSize + Math.floor(xy/volume.tileSize);
          const depth = volume.nodePosition(x,y,z).z - (volume.frontZ - volume.depth);
          deepest = Math.max(deepest,depth);
          if (depth > .108) shallow = false;
        }
      }
    }
    const partial = wall.partialDamageCount, removed = wall.removedIndices().length, nodes = wall.removedClayNodes;
    const document = game.levelEditor.document();
    game.room.mansionWing.restoreDemolition({}); game.levelEditor.applyDocument(document);
    const restored = wall.removedClayNodes;
    camera.position.set(15.3,1.65,14.4); camera.rotation.set(0,Math.PI,0); game.renderer.render();
    strikeMs.sort((a,b)=>a-b);
    const p95=values=>{values.sort((a,b)=>a-b);return values[Math.floor(values.length*.95)]??0;};
    return { contact, partial, removed, nodes, restored, shallow, deepest, saved:document.masonryDamage?.[wall.group.name]?.length ?? 0, strikeP95Ms:p95(strikeMs), strikeMaxMs:strikeMs.at(-1), impactP95Ms:p95(phaseMs.impact), meshP95Ms:p95(phaseMs.mesh), jointP95Ms:p95(phaseMs.joint) };
  });
  await page.locator('#game-canvas').screenshot({ path:resolve(out,'after.png') });
  const turnFrames = mobile ? await page.evaluate(async () => {
    const game=window.__wireTheHouse,camera=game.renderer.camera,intervals=[],renderMs=[];
    let accepted=0,previous=performance.now();
    for(let frame=0;frame<180;frame++){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const now=performance.now();if(frame>=30)intervals.push(now-previous);previous=now;
      camera.rotation.set(0,Math.PI+Math.sin(frame*.09)*.55,0);
      const started=performance.now();
      if(game.renderer.render())accepted++;
      await game.renderer.waitForFrame();
      if(frame>=30)renderMs.push(performance.now()-started);
    }
    intervals.sort((a,b)=>a-b);renderMs.sort((a,b)=>a-b);
    return {accepted,p95Ms:intervals[Math.floor(intervals.length*.95)],maxMs:intervals.at(-1),renderP95Ms:renderMs[Math.floor(renderMs.length*.95)],drawCalls:game.renderer.webgl.info.render.calls,triangles:game.renderer.webgl.info.render.triangles,error:game.renderer.renderError};
  }) : null;
  assert.equal(setup.hammerMode,'chase');
  assert.equal(setup.target,'Courtyard north fired-clay enclosure');
  assert(result.contact && result.nodes > 0 && result.partial > 1 && result.shallow && result.removed === 0, JSON.stringify(result));
  assert.equal(result.restored,result.nodes,JSON.stringify(result));
  assert(result.saved > 0,JSON.stringify(result));
  if(turnFrames)assert(turnFrames.accepted>=170&&turnFrames.maxMs<500&&!turnFrames.error&&turnFrames.p95Ms<Math.max(45,baselineTurnFrames.p95Ms*1.6),JSON.stringify({baselineTurnFrames,turnFrames}));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ setup, result, baselineTurnFrames, turnFrames, screenshots:out }));
} finally { await browser.close(); }
