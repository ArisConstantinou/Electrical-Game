import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const live = process.argv.includes('--live');
const dist = resolve('dist');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(context);
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp',
    '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
  if (!live) await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
    const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
    if (!file.startsWith(`${dist}\\`)) return route.abort();
    try {
      if (!(await stat(file)).isFile()) return route.abort();
      await route.fulfill({ status:200, contentType:mime[extname(file)] ?? 'application/octet-stream', body:await readFile(file) });
    } catch { await route.abort(); }
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(live
    ? 'http://127.0.0.1:5365/Electrical-Game/?mansion=preview&renderer=webgl'
    : 'https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout:120000 });
  await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click();
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    const wing = game.room.mansionWing, wall = wing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    const camera = game.renderer.camera;
    camera.position.set(15.3, 1.65, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    game.selectedTool = 'hammer';
    game.fpsRig.show('hammer');
    const target = wing.aimMasonry(camera);
    const contact = target ? game.fpsRig.contactMasonry(camera, target.point) : false;
    const before = wall.removedIndices().length;
    for (let hit = 0; hit < 6; hit++) game.performAction();
    const after = wall.removedIndices().length;
    const locallyRemoved = wall.removedClayNodes;
    const partialAfterHit = wall.partialDamageCount;
    const partialDocument = game.levelEditor.document();
    wing.restoreDemolition({});
    game.levelEditor.applyDocument(partialDocument);
    const partialRestored = wall.removedClayNodes;
    const capsAfterHit = wall.fractureCapCount;
    const player = game.player;
    player.wallWorkEnabled = false;
    const walk = (x = 15.3) => {
      camera.position.set(x, player.eyeHeight, 15.0);
      player.yaw = Math.PI;
      game.input.mobileMove.x = 0;
      game.input.mobileMove.y = -1;
      for (let i = 0; i < 160; i++) player.update(1/60);
      game.input.mobileMove.y = 0;
      return camera.position.z;
    };
    const blockedZ = walk();
    const upperInitiallyVisible=wing.masonryDemolition.get('L1 east fired-clay corridor wall').group.visible;
    for (let i = 0; i < wall.original.length; i++) {
      const matrix = wall.original[i].elements;
      if (Math.abs(matrix[12] - 1.8) < .76 && matrix[13] < 2.1) wall.strike(i);
    }
    wing.obstaclesAt(0);
    const openZ = walk();
    const intactZ = walk(13.5);
    const snapshot = wing.demolitionSnapshot();
    const document = game.levelEditor.document();
    wing.restoreDemolition({});
    const cleared = wall.removedIndices().length;
    game.levelEditor.applyDocument(document);
    const restored = wall.removedIndices().length;
    const capsRestored = wall.fractureCapCount;
    const targets = [
      ['recessed-room-back-9',20,1.65,9,-Math.PI/2],
      ['recessed-room-side-9--1',19.5,1.65,9,0],
      ['B1 unfinished workshop partition north',14.7,-1.75,3,-Math.PI/2],
      ['L1 east fired-clay corridor wall',7.5,4.95,5.5,-Math.PI/2],
    ].map(([id,x,y,z,yaw])=>{
      camera.position.set(x,y,z);camera.rotation.set(0,yaw,0);
      wing.updateGameplayVisibility(x,z,y-1.65);
      wing.obstaclesAt(y-1.65);
      const candidate=wing.masonryDemolition.get(id);
      return {expected:id,actual:wing.aimMasonry(camera)?.wall.group.name??null,
        direct:candidate?.aim(camera)?.distance??null,visible:candidate?.group.visible,
        parentVisible:candidate?.group.parent?.visible,
        bounds:candidate?.obstacle && [candidate.obstacle.minX,candidate.obstacle.maxX,candidate.obstacle.minZ,candidate.obstacle.maxZ,candidate.obstacle.minFloorY,candidate.obstacle.maxFloorY]};
    });
    const crossWall = wing.masonryDemolition.get('recessed-room-side-9--1');
    const crossIndex = crossWall.columns * 3 + 3;
    const crossStrike = crossWall.strike(crossIndex);
    const crossCaps = crossWall.fractureCapCount;
    crossWall.reset();
    const crossCapsReset = crossWall.fractureCapCount;
    for (let index=0; index<wall.original.length; index++) wall.strike(index);
    wing.obstaclesAt(0);
    const fullyOpened = wall.obstacle.minX === Infinity;
    wing.restoreDemolition({});
    wing.obstaclesAt(0);
    const capsReset = wall.fractureCapCount;
    const resetCollision = Number.isFinite(wall.obstacle.minX) && !wall.obstacle.segments && walk() < 15.8;
    game.levelEditor.applyDocument(document);
    wing.updateGameplayVisibility(15.3,14.3,0);
    camera.position.set(15.3, 1.65, 14.3);
    camera.rotation.set(0, Math.PI, 0);
    game.fpsRig.visible = false;
    game.renderer.render();
    return { target:target?.wall.group.name ?? null, distance:target?.distance ?? null,
      contact, locallyRemoved, partialAfterHit, partialRestored,
      partialSaved:partialDocument.masonryDamage?.[wall.group.name]?.length ?? 0,
      armReach:target && game.fpsRig.canReachPoint(camera,target.point,.12),
      gripReach:game.fpsRig.gripsReachable(camera,game.fpsRig.tools.get('hammer')),
      status:game.fpsRig.contactStatus, before, after, capsAfterHit, capsRestored, capsReset,
      blockedZ, openZ, intactZ, cleared, restored,
      saved:document.demolition?.[wall.group.name]?.length ?? 0,
      crossStrike,crossCaps,crossCapsReset,
      wallCount:wing.masonryDemolition.size,upperInitiallyVisible,targets,fullyOpened,resetCollision,
      collisionSegments:wall.obstacle.segments?.length ?? null, errors:game.renderer.renderError };
  });
  assert.equal(result.target, 'Courtyard north fired-clay enclosure');
  assert.equal(result.contact, true, `Hammer contact failed: ${JSON.stringify(result)}`);
  assert(result.after === result.before && result.locallyRemoved > 0 && result.partialAfterHit === 1,
    `Hammer must locally fracture a brick without removing it: ${JSON.stringify(result)}`);
  assert(result.partialSaved === 1 && result.partialRestored === result.locallyRemoved,
    `Local damage did not survive Studio document round trip: ${JSON.stringify(result)}`);
  assert(result.capsAfterHit === 0 && result.capsRestored > 0 && result.capsReset === 0,
    `Exposed hollow-clay cut faces did not track demolition and reset: ${JSON.stringify(result)}`);
  assert(result.crossStrike && result.crossCaps > 0 && result.crossCapsReset === 0,
    `Perpendicular wall cut faces did not track demolition and reset: ${JSON.stringify(result)}`);
  assert(result.blockedZ < 15.8, `Intact wall did not block the player: ${JSON.stringify(result)}`);
  assert(result.openZ > 16.4, `Demolished doorway did not open: ${JSON.stringify(result)}`);
  assert(result.intactZ < 15.8, `Intact masonry/structural column did not block: ${JSON.stringify(result)}`);
  assert.equal(result.cleared,0,'Resetting demolition must rebuild the intact wall');
  assert(result.saved>result.after,'Saved level missed demolition state');
  assert(result.restored > result.after, `Demolition state did not round trip: ${JSON.stringify(result)}`);
  assert(result.fullyOpened && result.resetCollision, `A fully demolished wall did not regain collision after reset: ${JSON.stringify(result)}`);
  assert(result.wallCount>40,`Expected mansion wall registry, found ${result.wallCount}`);
  assert(result.targets.every(item=>item.expected===item.actual),`Some wall faces cannot be targeted (L1 initially visible: ${result.upperInitiallyVisible}): ${JSON.stringify(result.targets)}`);
  assert.equal(result.errors, '');
  assert.deepEqual(errors, []);
  const out = resolve('output/mansion-masonry-demolition');
  await mkdir(out, {recursive:true});
  await page.locator('#game-canvas').screenshot({path:resolve(out,'doorway.png')});
  console.log(JSON.stringify({pass:true,live,result}));
} finally { await browser.close(); }
