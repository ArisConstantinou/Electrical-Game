import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const live = process.argv.includes('--live');
const mobile = process.argv.includes('--mobile');
const dist = resolve('dist');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
    deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
  });
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
  // Regression for a wall whose CPU instance matrix changed but whose static
  // GPU buffer still rendered the intact photographed brick over the opening.
  const visualProbe = await page.evaluate(async () => {
    const game = window.__wireTheHouse, wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    game.step = () => {};
    const camera = game.renderer.camera;
    camera.position.set(15.3, 1.65, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    camera.updateMatrixWorld(true);
    const target = game.room.mansionWing.aimMasonry(camera);
    const projected = target.point.clone().project(camera);
    game.renderer.render(); await game.renderer.waitForFrame();
    return { index: target.index, x: Math.round((projected.x + 1) * innerWidth / 2),
      y: Math.round((1 - projected.y) * innerHeight / 2), wall: wall.group.name };
  });
  const clip = { x: Math.max(0, visualProbe.x - 16), y: Math.max(0, visualProbe.y - 16), width: 32, height: 32 };
  const intactPixels = await page.screenshot({ clip });
  await page.evaluate(async index => {
    const game = window.__wireTheHouse, wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    wall.strike(index);
    game.renderer.render(); await game.renderer.waitForFrame();
  }, visualProbe.index);
  const openedPixels = await page.screenshot({ clip });
  assert(!intactPixels.equals(openedPixels), `Removed ${visualProbe.wall} brick still renders intact in the live canvas`);
  await page.evaluate(async () => {
    const game = window.__wireTheHouse;
    game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure').reset();
    game.renderer.render(); await game.renderer.waitForFrame();
  });
  const jointProbe = await page.evaluate(index => {
    const game = window.__wireTheHouse, wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    const camera = game.renderer.camera, center = camera.position.clone(), rotation = camera.quaternion.clone(), size = camera.position.clone();
    wall.original[index].decompose(center, rotation, size);
    center.applyMatrix4(wall.group.matrixWorld);
    camera.position.set(center.x, center.y - size.y / 2 - .005, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    const aim = game.room.mansionWing.aimMasonry(camera);
    const hit = aim?.wall === wall && wall.strikeAt(aim.index, camera, 'demolish');
    const removed = [...(wall.broken.get(index)?.mortarRemoved ?? [])].filter(Boolean).length;
    const save = wall.damageSnapshot();
    wall.reset(); wall.restoreDamage(save);
    const restored = [...(wall.broken.get(index)?.mortarRemoved ?? [])].filter(Boolean).length;
    wall.reset();
    return { index, aimedIndex: aim?.index ?? null, hit, removed, restored };
  }, visualProbe.index);
  assert(jointProbe.hit && jointProbe.aimedIndex === visualProbe.index && jointProbe.removed === 1 && jointProbe.restored === 1,
    `Mortar joint cannot be broken and restored: ${JSON.stringify(jointProbe)}`);
  const result = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    game.step = () => {};
    const wing = game.room.mansionWing, wall = wing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    const camera = game.renderer.camera;
    camera.position.set(15.3, 1.65, 15.0);
    camera.rotation.set(0, Math.PI, 0);
    game.selectedTool = 'hammer';
    game.hammerMode = 'demolish';
    game.fpsRig.show('hammer');
    const target = wing.aimMasonry(camera);
    const contact = target ? game.fpsRig.contactMasonry(camera, target.point) : false;
    const before = wall.removedIndices().length;
    for (let hit = 0; hit < 6; hit++) game.performAction();
    const fallingAfterHit = wall.rubble?.fallingCount ?? 0;
    const fallingPiece = wall.rubble?.falling.find(piece => !piece.settled);
    const fallingStartY = fallingPiece?.position.y ?? null;
    for (let frame = 0; frame < 12; frame++) wall.rubble?.step(1 / 60);
    const fallingEndY = fallingPiece?.position.y ?? null;
    const after = wall.removedIndices().length;
    const locallyRemoved = wall.removedClayNodes;
    const partialAfterHit = wall.partialDamageCount;
    const partialDocument = game.levelEditor.document();
    const partialSavedSide = partialDocument.demolitionSides?.[wall.group.name] ?? null;
    wing.restoreDemolition({});
    game.levelEditor.applyDocument(partialDocument);
    const partialRestored = wall.removedClayNodes;
    const partialRestoredSide = wall.rubbleSide;
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
    const strikeMs = [];
    for (let i = 0; i < wall.original.length; i++) {
      const matrix = wall.original[i].elements;
      if (Math.abs(matrix[12] - 1.8) < .76 && matrix[13] < 2.1) {
        const start = performance.now();
        wall.strike(i);
        strikeMs.push(performance.now() - start);
      }
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
    const restoredSide = wall.rubbleSide;
    const capsRestored = wall.fractureCapCount;
    const fracturedEndsRestored = wall.fracturedEndCount;
    const fracturedEndDepthMm = wall.fracturedEndDepthMm;
    const leftCuts = [...wall.chippedDepths].filter(([key])=>key.endsWith(':-1')).map(([,depth])=>depth);
    const rightCuts = [...wall.chippedDepths].filter(([key])=>key.endsWith(':1')).map(([,depth])=>depth);
    const independentCutPairs = Math.min(leftCuts.length,rightCuts.length);
    const independentCuts = Array.from({length:independentCutPairs},(_,i)=>Math.abs(leftCuts[i]-rightCuts[i])).filter(d=>d>.03).length;
    const rubbleSections = wall.rubble?.sections;
    const clayFineMeshes = [wall.rubble?.clayGrit, wall.rubble?.clayChunks, wall.rubble?.claySlivers];
    const renderFineMeshes = [wall.rubble?.renderGrit, wall.rubble?.renderChunks, wall.rubble?.renderSlivers];
    const fineClayCount = clayFineMeshes.reduce((total, mesh) => total + (mesh?.count ?? 0), 0);
    const fineRenderCount = renderFineMeshes.reduce((total, mesh) => total + (mesh?.count ?? 0), 0);
    const fineShapes = new Set([...clayFineMeshes, ...renderFineMeshes].filter(mesh => mesh?.count).map(mesh => mesh.geometry.uuid)).size;
    let fineNearCount = 0, fineFarCount = 0;
    for (const mesh of [...clayFineMeshes, ...renderFineMeshes]) if (mesh) for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, wall.temp);
      const out = Math.abs(wall.alongX ? wall.temp.elements[14] : wall.temp.elements[12]);
      if (out < .75) fineNearCount++;
      if (out > 1.18) fineFarCount++;
    }
    const rampPositions = wall.rubble?.mound.geometry.getAttribute('position');
    let rampAtWall = 0, rampAtToe = 0, rampHighestOut = Infinity, rampHighest = 0;
    if (rampPositions) for (let i=0;i<rampPositions.count;i++) {
      const out = Math.abs(wall.alongX ? rampPositions.getZ(i) : rampPositions.getX(i));
      const height = rampPositions.getY(i);
      if (out < .13) rampAtWall = Math.max(rampAtWall,height);
      if (out > .75) rampAtToe = Math.max(rampAtToe,height);
      if (height > rampHighest) { rampHighest = height; rampHighestOut = out; }
    }
    const rubbleOffsets = [];
    if (rubbleSections) for (let i=0;i<rubbleSections.count;i++) {
      rubbleSections.getMatrixAt(i, wall.temp);
      rubbleOffsets.push(wall.alongX ? wall.temp.elements[14] : wall.temp.elements[12]);
    }
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
    const crossFracturedEnds = crossWall.fracturedEndCount;
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
      contact, locallyRemoved, partialAfterHit, partialRestored, fallingAfterHit, fallingStartY, fallingEndY,
      partialSaved:partialDocument.masonryDamage?.[wall.group.name]?.length ?? 0,
      armReach:target && game.fpsRig.canReachPoint(camera,target.point,.12),
      gripReach:game.fpsRig.gripsReachable(camera,game.fpsRig.tools.get('hammer')),
      status:game.fpsRig.contactStatus, before, after, capsAfterHit, capsRestored, capsReset,
      blockedZ, openZ, intactZ, cleared, restored,
      fracturedEndsRestored, fracturedEndDepthMm, independentCuts, independentCutPairs,
      rubbleOffsets, fineClayCount, fineRenderCount, fineShapes, fineNearCount, fineFarCount,
      rampAtWall, rampAtToe, rampHighestOut,
      partialSavedSide, partialRestoredSide, restoredSide,
      crossFracturedEnds, strikeMs,
      saved:document.demolition?.[wall.group.name]?.length ?? 0,
      crossStrike,crossCaps,crossCapsReset,
      wallCount:wing.masonryDemolition.size,upperInitiallyVisible,targets,fullyOpened,resetCollision,
      collisionSegments:wall.obstacle.segments?.length ?? null, errors:game.renderer.renderError };
  });
  assert.equal(result.target, 'Courtyard north fired-clay enclosure');
  assert.equal(result.contact, true, `Hammer contact failed: ${JSON.stringify(result)}`);
  assert(result.after === result.before && result.locallyRemoved > 0 && result.partialAfterHit === 1,
    `Hammer must locally fracture a brick without removing it: ${JSON.stringify(result)}`);
  assert(result.fallingAfterHit > 0 && result.fallingEndY < result.fallingStartY,
    `Hammer fragments did not visibly fall: ${JSON.stringify(result)}`);
  assert(result.partialSaved === 1 && result.partialRestored === result.locallyRemoved,
    `Local damage did not survive Studio document round trip: ${JSON.stringify(result)}`);
  assert(result.partialSavedSide === -1 && result.partialRestoredSide === -1 && result.restoredSide === -1,
    `First hammer side did not survive Studio document round trip: ${JSON.stringify(result)}`);
  assert(result.capsAfterHit === 0 && result.fracturedEndsRestored > 0 && result.fracturedEndDepthMm > 0 && result.capsReset === 0,
    `Exposed hollow-clay fracture did not track demolition and reset: ${JSON.stringify(result)}`);
  assert(result.crossStrike && result.crossFracturedEnds > 0 && result.crossCapsReset === 0,
    `Perpendicular wall fracture did not track demolition and reset: ${JSON.stringify(result)}`);
  assert(result.independentCutPairs >= 10 && result.independentCuts >= 6,
    `Opposite sides of the opening share a mirrored fracture: ${JSON.stringify(result)}`);
  assert(result.rubbleOffsets.length >= 20 && result.rubbleOffsets.every(offset=>offset<0),
    `Rubble spilled onto the opposite side of the wall: ${JSON.stringify(result)}`);
  assert(result.fineClayCount >= 450 && result.fineRenderCount >= 200 && result.fineShapes === 3,
    `Fine rubble lost its varied clay/plaster shapes: ${JSON.stringify(result)}`);
  assert(result.fineNearCount / (result.fineClayCount + result.fineRenderCount) > .8 && result.fineFarCount === 0,
    `Fine rubble spread too far from the wall: ${JSON.stringify(result)}`);
  assert(result.rampAtWall > .3 && result.rampAtToe < .02 && result.rampHighestOut < .13,
    `Rubble must form a ramp whose highest edge meets the broken wall: ${JSON.stringify(result)}`);
  const sortedStrikeMs=[...result.strikeMs].sort((a,b)=>a-b);
  assert(sortedStrikeMs[Math.floor(sortedStrikeMs.length*.95)] < 8,
    `Exposed-end treatment stalled demolition: ${JSON.stringify(result)}`);
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
  const out = resolve(mobile ? 'output/mansion-masonry-demolition/mobile' : 'output/mansion-masonry-demolition');
  await mkdir(out, {recursive:true});
  await page.locator('#game-canvas').screenshot({path:resolve(out,'doorway.png')});
  await page.evaluate(() => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    camera.position.set(15.3, 1.65, 14.3);
    camera.rotation.set(-.43, Math.PI, 0);
    game.renderer.render();
  });
  await page.locator('#game-canvas').screenshot({path:resolve(out,'rubble.png')});
  await page.evaluate(() => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    camera.position.set(15.3, .76, 14.85);
    camera.rotation.set(-.52, Math.PI, 0);
    game.renderer.render();
  });
  await page.locator('#game-canvas').screenshot({path:resolve(out,'rubble-close.png')});
  await page.evaluate(() => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    camera.position.set(14.0,1.05,14.7);
    camera.lookAt(15.3,.18,15.85);
    game.renderer.render();
  });
  await page.locator('#game-canvas').screenshot({path:resolve(out,'rubble-ramp.png')});
  const turnFrames = mobile ? await page.evaluate(async () => {
    const game = window.__wireTheHouse, camera = game.renderer.camera;
    camera.position.set(15.3,1.65,14.3);
    const intervals = [];
    let accepted = 0, previous = performance.now();
    for (let frame=0;frame<120;frame++) {
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const now = performance.now();
      intervals.push(now-previous); previous=now;
      camera.rotation.set(0,Math.PI+Math.sin(frame*.09)*.65,0);
      if (game.renderer.render()) accepted++;
      await game.renderer.waitForFrame();
    }
    intervals.sort((a,b)=>a-b);
    return {accepted,p95Ms:intervals[Math.floor(intervals.length*.95)],maxMs:intervals.at(-1),error:game.renderer.renderError};
  }) : null;
  if (turnFrames) assert(turnFrames.accepted >= 100 && turnFrames.maxMs < 500 && !turnFrames.error,
    `Mobile viewport stalled while turning after demolition: ${JSON.stringify(turnFrames)}`);
  const reverseSide = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
    wall.reset();
    const camera = game.renderer.camera;
    wall.group.updateWorldMatrix(true,false);
    const cameraLocal = wall.position.clone().set(1.8,1.65,.9);
    const aimLocal = wall.position.clone().set(1.8,1.65,0);
    camera.position.copy(wall.group.localToWorld(cameraLocal));
    camera.lookAt(wall.group.localToWorld(aimLocal));
    const aim = wall.aim(camera);
    const hit = aim ? wall.strikeAt(aim.index,camera) : false;
    for (const index of [10,11,12,13]) wall.strike(index);
    const sections = wall.rubble?.sections;
    const offsets = [];
    if (sections) for (let i=0;i<sections.count;i++) {
      sections.getMatrixAt(i,wall.temp);
      offsets.push(wall.alongX ? wall.temp.elements[14] : wall.temp.elements[12]);
    }
    const document = game.levelEditor.document();
    game.room.mansionWing.restoreDemolition({});
    game.levelEditor.applyDocument(document);
    return { hit, offsets, restoredSide:wall.rubbleSide };
  });
  assert(reverseSide.hit && reverseSide.offsets.length >= 2 && reverseSide.offsets.every(offset=>offset>0) && reverseSide.restoredSide === 1,
    `Rubble did not follow an opposite-side first impact: ${JSON.stringify(reverseSide)}`);
  const sorted=[...result.strikeMs].sort((a,b)=>a-b);
  console.log(JSON.stringify({pass:true,live,mobile,removed:result.restored,
    asymmetricCuts:`${result.independentCuts}/${result.independentCutPairs}`,
    strikeP95Ms:sorted[Math.floor(sorted.length*.95)],
    turnFrames,
    nearSideRubbleCount:result.rubbleOffsets.length,
    fineClayCount:result.fineClayCount,fineRenderCount:result.fineRenderCount,
    fineShapes:result.fineShapes,fineNearCount:result.fineNearCount,fineFarCount:result.fineFarCount,
    rampAtWall:result.rampAtWall,rampAtToe:result.rampAtToe,
    oppositeSideHit:reverseSide.hit,oppositeSideRubbleCount:reverseSide.offsets.length}));
} finally { await browser.close(); }
