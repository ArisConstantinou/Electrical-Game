import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5362/Electrical-Game/';
const output = new URL('../output/qa/', import.meta.url);
await mkdir(output, { recursive: true });
const outputPath = name => fileURLToPath(new URL(name, output));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const aimAtActive = page => page.evaluate(() => {
  const game = window.__wireTheHouse;
  const point = game.mission.activePoint;
  if (!point) return;
  const targetX = point.position.x;
  const targetY = point.position.y;
  game.renderer.camera.position.set(targetX, 1.36, -0.72);
  const dy = targetY - game.renderer.camera.position.y;
  const dz = -2.41 - game.renderer.camera.position.z;
  game.player.yaw = 0;
  game.player.pitch = Math.atan2(dy, Math.abs(dz));
  game.renderer.camera.rotation.set(game.player.pitch, 0, 0);
  game.step(1 / 60);
});
const action = async page => { await page.keyboard.press('KeyE'); await page.evaluate(() => window.advanceTime(34)); };
const leftClickAction = async page => {
  await page.mouse.down({ button: 'left' });
  await page.evaluate(() => window.advanceTime(34));
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(100);
};
const unlockedLeftClickAction = async (page, holdMs = 34) => {
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(80);
  if (await page.evaluate(() => Boolean(document.pointerLockElement))) throw new Error('Could not release Pointer Lock before primary-click regression');
  await page.mouse.down({ button: 'left' });
  await page.evaluate(ms => window.advanceTime(ms), holdMs);
  await page.mouse.up({ button: 'left' });
};
const mobileAimAction = async page => {
  await page.evaluate(() => {
    const game = window.__wireTheHouse;
    const look = document.querySelector('#look-joystick');
    const rect = look.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dispatch = (type, pointerId, clientX = x, clientY = y) => look.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX, clientY, bubbles: true, cancelable: true }));
    if (game.selectedTool === 'spray' || game.selectedTool === 'hammer') {
      dispatch('pointerdown', 881);
      dispatch('pointermove', 881, x + rect.width * .2, y);
      window.advanceTime(game.selectedTool === 'hammer' ? 260 : 60);
      dispatch('pointerup', 881, x + rect.width * .2, y);
      if (game.selectedTool === 'hammer') window.advanceTime(34);
      return;
    }
    dispatch('pointerdown', 881);
    dispatch('pointermove', 881, x + rect.width * .12, y - rect.height * .05);
    dispatch('pointerup', 881, x + rect.width * .12, y - rect.height * .05);
    window.advanceTime(34);
  });
};
const mobileTap = async (page, selector) => {
  await page.locator(selector).tap();
  await page.evaluate(() => window.advanceTime(34));
};
const reachLeveling = async page => {
  const surfaceBeforeChase = (await state(page)).workSurface;
  await page.keyboard.press('Digit3');
  await action(page);
  await page.keyboard.press('Digit4');
  for (let index = 0; index < 4; index += 1) await action(page);
  const chaseComplete = await state(page);
  if (chaseComplete.workSurface.destroyedBricks !== surfaceBeforeChase.destroyedBricks) throw new Error('CHASE destroyed bricks instead of recessing them');
  if (chaseComplete.workSurface.recessedBricks <= surfaceBeforeChase.recessedBricks) throw new Error('CHASE did not create a recessed wall channel');
  if (chaseComplete.activePoint.id === 'A') {
    const demolitionBefore = chaseComplete.workSurface;
    await page.keyboard.press('KeyX');
    if ((await state(page)).workSurface.hammerMode !== 'demolish') throw new Error('X did not switch hammer to DEMOLISH');
    await page.evaluate(() => {
      const game = window.__wireTheHouse;
      game.player.yaw += 0.1;
      game.renderer.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
      game.step(1 / 60);
    });
    for (let hit = 0; hit < 4; hit += 1) {
      await action(page);
      await page.evaluate(() => window.advanceTime(260));
    }
    const demolitionAfter = (await state(page)).workSurface;
    if (demolitionAfter.destroyedBricks !== demolitionBefore.destroyedBricks || demolitionAfter.maximumDemolitionDepthMm < 12 || demolitionAfter.maximumDemolitionDepthMm >= 100) throw new Error(`Four demo-hammer hits should make a partial-depth crater, not an easy through-hole: ${JSON.stringify({ demolitionBefore, demolitionAfter })}`);
    await page.keyboard.press('KeyX');
    await aimAtActive(page);
  }
  if ((await state(page)).activePoint.id === 'A') await page.screenshot({ path: outputPath('desktop-real-chase.png') });
  await page.keyboard.press('Digit5');
  await aimAtActive(page);
  await action(page);
  await action(page);
  if ((await state(page)).activePoint.id === 'A') await page.screenshot({ path: outputPath('desktop-mortar-flush.png') });
  await page.keyboard.press('Digit6');
  await action(page);
  const current = await state(page);
  if (current.activePoint.stage !== 'leveling') throw new Error(`Expected leveling, got ${current.activePoint.stage}`);
  if (current.activePoint.id === 'A') await page.screenshot({ path: outputPath('desktop-leveling.png') });
};
const finishPipe = async page => {
  await page.keyboard.press('Digit1');
  await action(page);
  await page.keyboard.press('Digit2');
  await action(page);
  await page.keyboard.press('Digit1');
  await action(page);
  await action(page);
};

const tallDesktop = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await tallDesktop.goto(baseUrl, { waitUntil: 'networkidle' });
const tallLayout = await tallDesktop.evaluate(() => {
  const shell = document.querySelector('#game-shell').getBoundingClientRect();
  return { innerHeight, shellHeight: shell.height, shellBottom: shell.bottom, footerCount: document.querySelectorAll('.page-footer').length, scrollHeight: document.documentElement.scrollHeight };
});
if (Math.abs(tallLayout.shellHeight - tallLayout.innerHeight) > 1 || tallLayout.footerCount !== 0 || tallLayout.scrollHeight !== tallLayout.innerHeight) throw new Error(`Tall desktop game does not fill viewport: ${JSON.stringify(tallLayout)}`);
await tallDesktop.screenshot({ path: outputPath('desktop-tall-viewport.png') });
await tallDesktop.close();

const hybridDesktop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await hybridDesktop.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 10 }));
await hybridDesktop.goto(baseUrl, { waitUntil: 'networkidle' });
await hybridDesktop.click('#start-button');
await hybridDesktop.waitForTimeout(120);
const hybridPointerLock = await hybridDesktop.evaluate(() => ({
  finePointer: matchMedia('(any-pointer: fine)').matches,
  maxTouchPoints: navigator.maxTouchPoints,
  lockedCanvas: document.pointerLockElement === document.querySelector('#game-canvas'),
}));
if (!hybridPointerLock.finePointer || hybridPointerLock.maxTouchPoints !== 10 || !hybridPointerLock.lockedCanvas) {
  throw new Error(`Touch-capable desktop did not retain mouse Pointer Lock: ${JSON.stringify(hybridPointerLock)}`);
}
await hybridDesktop.close();

const demolition = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await demolition.goto(baseUrl, { waitUntil: 'networkidle' });
await demolition.click('#start-button');
await demolition.waitForTimeout(450);
await demolition.keyboard.press('Digit4');
await demolition.keyboard.press('KeyX');
if ((await state(demolition)).workSurface.hammerMode !== 'demolish') throw new Error('Standalone demolition mode did not activate');
const excavateAtHeight = async targetY => {
  await demolition.evaluate(y => {
    const game = window.__wireTheHouse;
    game.renderer.camera.position.set(0, 1.65, -0.35);
    game.player.yaw = 0;
    game.player.pitch = Math.atan2(y - 1.65, 2.06);
    game.renderer.camera.rotation.set(game.player.pitch, 0, 0);
    game.step(1 / 60);
  }, targetY);
  const before = (await state(demolition)).workSurface;
  await demolition.evaluate(y => {
    const game = window.__wireTheHouse;
    game.renderer.camera.position.set(0, 1.65, -0.35);
    game.player.yaw = 0;
    game.player.pitch = Math.atan2(y - 1.65, 2.06);
    game.renderer.camera.rotation.set(game.player.pitch, 0, 0);
    game.chasing.freeHit(game.renderer.camera);
    game.chasing.update(1 / 60);
    game.renderer.render();
  }, targetY);
  const chipped = (await state(demolition)).workSurface;
  if (chipped.destroyedBricks !== before.destroyedBricks || chipped.damagedBricks <= before.damagedBricks || chipped.activeFragments < 1) {
    throw new Error(`First DEMOLISH impact did not chip/crack the brick before destruction at wall height ${targetY}`);
  }
  for (let hit = 1; hit < 4; hit += 1) {
    await demolition.evaluate(y => {
      const game = window.__wireTheHouse;
      game.renderer.camera.position.set(0, 1.65, -0.35);
      game.player.yaw = 0;
      game.player.pitch = Math.atan2(y - 1.65, 2.06);
      game.renderer.camera.rotation.set(game.player.pitch, 0, 0);
      game.chasing.freeHit(game.renderer.camera);
      game.chasing.update(0.26);
      game.renderer.render();
    }, targetY);
  }
  const after = (await state(demolition)).workSurface;
  if (after.destroyedBricks !== before.destroyedBricks || after.breachedWallCells !== before.breachedWallCells || after.maximumDemolitionDepthMm < 12 || after.maximumDemolitionDepthMm >= 100 || after.activeFragments < 10) throw new Error(`Four DEMOLISH impacts did not leave a deep but non-through random crater at wall height ${targetY}: ${JSON.stringify({ before, after })}`);
};
await excavateAtHeight(2.93);
await excavateAtHeight(0.07);
const variedWallDamage = (await state(demolition)).workSurface;
const variedImpactProfiles = await demolition.evaluate(() => window.__wireTheHouse.room.brickWall.demolitionSites.filter(site => site.severity >= 1).map(site => ({ rotation: Number(site.rotation.toFixed(3)), aspect: Number((site.radiusX / site.radiusY).toFixed(3)), lobes: `${site.lobeFrequencyA}:${site.lobeFrequencyB}`, depth: Number((site.excavationDepth * 1000).toFixed(1)) })));
if (variedWallDamage.floatingStaticPieces !== 0 || variedWallDamage.unsupportedAnchoredRemnants !== 0 || variedWallDamage.fracturePatterns < 2 || variedWallDamage.breachedWallCells !== 0 || variedWallDamage.deformedWallCells < 100 || variedWallDamage.maximumFractureSpan < 0.2 || new Set(variedImpactProfiles.map(profile => JSON.stringify(profile))).size < 2) {
  throw new Error(`DEMOLISH did not produce distinct random partial-depth wall damage: ${JSON.stringify({ variedWallDamage, variedImpactProfiles })}`);
}
await demolition.evaluate(() => {
  const game = window.__wireTheHouse;
  game.renderer.camera.position.set(0, 1.5, 0.2);
  game.player.yaw = 0;
  game.player.pitch = 0;
  game.renderer.camera.rotation.set(0, 0, 0);
  game.step(1 / 60);
});
await demolition.screenshot({ path: outputPath('desktop-top-bottom-demolition.png') });
const clusterSupportResult = await demolition.evaluate(() => {
  const game = window.__wireTheHouse;
  const wall = game.room.brickWall;
  const camera = game.renderer.camera;
  const targets = wall.targets.filter(target => Math.abs(target.center.x) < 0.46 && Math.abs(target.center.y - 1.5) < 0.24);
  camera.position.set(0, 1.5, -0.55);
  for (const target of targets) {
    let attempts = 0;
    while (!target.destroyed && attempts < 24) {
      camera.lookAt(target.center);
      camera.updateMatrixWorld(true);
      game.chasing.freeHit(camera);
      game.chasing.update(1 / 60);
      attempts += 1;
    }
  }
  window.advanceTime(2200);
  const retainedStaticTargets = targets.filter(target => target.replacement).map(target => ({ id: target.id, supportedComponents: Number(target.replacement.userData.supportedComponents ?? 0), unsupportedComponents: Number(target.replacement.userData.unsupportedComponents ?? 0) }));
  game.renderer.render();
  return {
    targetCount: targets.length,
    destroyedCount: targets.filter(target => target.destroyed).length,
    maximumDemolitionDepthMm: wall.maximumDemolitionDepthMm,
    retainedStaticTargets,
    floatingStaticPieces: wall.floatingStaticPieceCount,
    unsupportedAnchoredRemnants: wall.unsupportedAnchoredRemnantCount,
    airborneFragments: game.chasing.airborneFragmentCount,
    airborneSample: game.chasing.particles.filter(particle => !particle.settled).slice(0, 8).map(particle => ({
      y: Number(particle.mesh.position.y.toFixed(3)),
      vy: Number(particle.velocity.y.toFixed(3)),
      life: Number(particle.life.toFixed(3)),
    })),
    unsupportedSettledFragments: game.chasing.unsupportedSettledFragmentCount,
    rubblePileHeight: game.chasing.rubblePileHeight,
  };
});
if (clusterSupportResult.targetCount < 9 || clusterSupportResult.maximumDemolitionDepthMm < 70 || clusterSupportResult.retainedStaticTargets.some(target => target.supportedComponents < 1 || target.unsupportedComponents !== 0) || clusterSupportResult.floatingStaticPieces !== 0 || clusterSupportResult.unsupportedAnchoredRemnants !== 0 || clusterSupportResult.airborneFragments !== 0 || clusterSupportResult.unsupportedSettledFragments !== 0 || clusterSupportResult.rubblePileHeight > 0.161) {
  throw new Error(`Contiguous demolition left floating static geometry: ${JSON.stringify(clusterSupportResult)}`);
}
const supportExpiryResult = await demolition.evaluate(() => {
  const game = window.__wireTheHouse;
  const particles = game.chasing.particles;
  for (const particle of particles) {
    if (particle.settled && particle.mesh.position.y <= particle.halfHeight + 0.004) particle.life = 0;
  }
  window.advanceTime(1200);
  game.renderer.render();
  return {
    airborneFragments: game.chasing.airborneFragmentCount,
    unsupportedSettledFragments: game.chasing.unsupportedSettledFragmentCount,
    rubblePileHeight: game.chasing.rubblePileHeight,
  };
});
if (supportExpiryResult.airborneFragments !== 0 || supportExpiryResult.unsupportedSettledFragments !== 0 || supportExpiryResult.rubblePileHeight > 0.161) {
  throw new Error(`Rubble remained suspended after its lower support expired: ${JSON.stringify(supportExpiryResult)}`);
}
await demolition.screenshot({ path: outputPath('desktop-demolition-supported-shells.png') });
const fullWallResult = await demolition.evaluate(() => {
  const game = window.__wireTheHouse;
  const wall = game.room.brickWall;
  const camera = game.renderer.camera;
  camera.position.set(0, 1.5, 0.2);
  let pass = 0;
  while (pass < 8 && wall.destroyedBrickCount < 472) {
    for (let row = 0; row < 23; row += 1) {
      for (let col = 0; col < 21; col += 1) {
        const x = -3 + (6 / 21) / 2 + col * (6 / 21) + (row % 2 ? (6 / 21) / 2 : 0);
        if (x > 2.98) continue;
        const y = (3 / 23) / 2 + row * (3 / 23);
        camera.lookAt(x, y, -2.5);
        camera.updateMatrixWorld(true);
        wall.removeAtAim(camera);
      }
    }
    pass += 1;
  }
  return {
    destroyed: wall.destroyedBrickCount,
    passes: pass,
    retainedStaticTargets: wall.targets.filter(target => target.destroyed && target.replacement).length,
    unsupportedRetainedTargets: wall.targets.filter(target => target.destroyed && target.replacement && Number(target.replacement.userData.supportedComponents ?? 0) < 1).length,
    affectedTargets: wall.targets.filter(target => target.originalHidden).length,
    breachedWallCells: wall.breachedWallCellCount,
    deformedWallCells: wall.deformedWallCellCount,
    maximumDemolitionDepthMm: wall.maximumDemolitionDepthMm,
    unsupportedAnchoredRemnants: wall.unsupportedAnchoredRemnantCount,
  };
});
if (fullWallResult.affectedTargets !== 472 || fullWallResult.maximumDemolitionDepthMm < 20 || fullWallResult.destroyed >= fullWallResult.affectedTargets || fullWallResult.deformedWallCells < 30000 || fullWallResult.unsupportedRetainedTargets !== 0 || fullWallResult.unsupportedAnchoredRemnants !== 0) throw new Error(`Full-wall hammer scan did not preserve a resistant connected wall-scale damage field: ${JSON.stringify(fullWallResult)}`);
await demolition.screenshot({ path: outputPath('desktop-full-wall-demolished.png') });
await demolition.close();

const demolitionDetail = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await demolitionDetail.goto(baseUrl, { waitUntil: 'networkidle' });
await demolitionDetail.click('#start-button');
await demolitionDetail.waitForTimeout(300);
await demolitionDetail.keyboard.press('Digit4');
await demolitionDetail.keyboard.press('KeyX');
await demolitionDetail.evaluate(() => {
  const game = window.__wireTheHouse;
  game.renderer.camera.position.set(0.286, 1.37, -1.45);
  game.renderer.camera.lookAt(0.286, 1.37, -2.5);
  game.renderer.camera.updateMatrixWorld(true);
  game.player.yaw = 0;
  game.player.pitch = 0;
  game.input.resetTransientInput();
  game.started = false;
  const target = game.room.brickWall.aim(game.renderer.camera)?.target;
  if (!target) throw new Error('Could not resolve a demolition detail brick');
  game.qaDemolitionTarget = target.center.clone();
  game.renderer.camera.lookAt(target.center);
  game.renderer.camera.updateMatrixWorld(true);
});
for (let hit = 0; hit < 3; hit += 1) {
  await demolitionDetail.evaluate(() => {
    const game = window.__wireTheHouse;
    game.renderer.camera.lookAt(game.qaDemolitionTarget);
    game.renderer.camera.updateMatrixWorld(true);
    game.chasing.freeHit(game.renderer.camera);
    game.chasing.update(1 / 60);
    game.renderer.render();
  });
}
const crackedState = await state(demolitionDetail);
if (crackedState.workSurface.destroyedBricks !== 0 || crackedState.workSurface.damagedBricks !== 1 || crackedState.workSurface.fractureSegments < 8 || crackedState.workSurface.maximumFractureSpan < 0.3 || crackedState.workSurface.deformedWallCells < 100) throw new Error(`DEMOLISH skipped wall-scale progressive cracking and deformation: ${JSON.stringify(crackedState.workSurface)}`);
await demolitionDetail.screenshot({ path: outputPath('desktop-progressive-demolition-cracks.png') });
await demolitionDetail.evaluate(() => {
  const game = window.__wireTheHouse;
  game.renderer.camera.lookAt(game.qaDemolitionTarget);
  game.renderer.camera.updateMatrixWorld(true);
  game.chasing.freeHit(game.renderer.camera);
  game.chasing.update(1 / 60);
  game.renderer.render();
});
const fracturedState = await state(demolitionDetail);
if (fracturedState.workSurface.destroyedBricks !== 0 || fracturedState.workSurface.damagedBricks !== 1 || fracturedState.workSurface.breachedWallCells !== 0 || fracturedState.workSurface.maximumDemolitionDepthMm < 12 || fracturedState.workSurface.maximumDemolitionDepthMm >= 100 || fracturedState.workSurface.activeFragments < 14 || fracturedState.workSurface.deformedWallCells < 80 || fracturedState.workSurface.floatingStaticPieces !== 0) {
  throw new Error(`Four DEMOLISH hits did not finish with bonded partial-depth wall damage: ${JSON.stringify(fracturedState.workSurface)}`);
}
await demolitionDetail.screenshot({ path: outputPath('desktop-progressive-demolition-fragments.png') });
const solidFragmentMaterials = await demolitionDetail.evaluate(() => {
  const materials = [];
  window.__wireTheHouse.renderer.scene.traverse(object => {
    if (!object.isMesh || object.name !== 'Loose masonry fragment') return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) materials.push({ transparent: material.transparent, depthWrite: material.depthWrite, opacity: material.opacity });
  });
  return materials;
});
if (solidFragmentMaterials.length < 1 || solidFragmentMaterials.some(material => material.transparent || !material.depthWrite || material.opacity !== 1)) {
  throw new Error(`Fracture remnants are not solid opaque geometry: ${JSON.stringify(solidFragmentMaterials)}`);
}
await demolitionDetail.evaluate(() => window.advanceTime(2200));
const piledState = await state(demolitionDetail);
if (piledState.workSurface.airborneFragments !== 0 || piledState.workSurface.settledFragments < 20 || piledState.workSurface.rubblePileHeight < 0.04 || piledState.workSurface.rubblePileHeight > 0.161 || piledState.workSurface.unsupportedSettledFragments !== 0 || piledState.workSurface.overlappingSettledFragments !== 0) {
  throw new Error(`Rubble did not fall into a non-overlapping floor pile: ${JSON.stringify(piledState.workSurface)}`);
}
await demolitionDetail.screenshot({ path: outputPath('desktop-demolition-rubble-pile.png') });
await demolitionDetail.close();

const paintedChase = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await paintedChase.goto(baseUrl, { waitUntil: 'networkidle' });
await paintedChase.click('#start-button');
await paintedChase.waitForTimeout(450);
await paintedChase.evaluate(() => {
  const game = window.__wireTheHouse;
  const targetY = 0.72;
  game.renderer.camera.position.set(-0.8, 1.65, -2);
  game.player.yaw = 0;
  game.player.pitch = Math.atan2(targetY - 1.65, 0.39);
  game.renderer.camera.rotation.set(game.player.pitch, 0, 0);
  game.step(1 / 60);
});
await paintedChase.keyboard.press('Digit3');
await paintedChase.mouse.down({ button: 'left' });
await paintedChase.evaluate(() => window.advanceTime(80));
if ((await state(paintedChase)).activePoint.stage !== 'marked') throw new Error('Off-centre freehand spray did not mark the active point');
const heldAfterSpray = await paintedChase.evaluate(() => window.__wireTheHouse.input.actionHeld);
const offRouteSurfaceBefore = (await state(paintedChase)).workSurface;
await paintedChase.keyboard.press('Digit4');
const heldAfterToolSwitch = await paintedChase.evaluate(() => window.__wireTheHouse.input.actionHeld);
await paintedChase.evaluate(() => window.advanceTime(1100));
await paintedChase.mouse.up({ button: 'left' });
const offRouteChase = await state(paintedChase);
if (offRouteChase.activePoint.stage !== 'chasing' || offRouteChase.activePoint.chaseHits !== 1 || offRouteChase.workSurface.recessedBricks <= offRouteSurfaceBefore.recessedBricks) {
  throw new Error(`CHASE did not start while the player kept holding action after switching from spray: ${JSON.stringify({ heldAfterSpray, heldAfterToolSwitch, offRouteChase })}`);
}
if (offRouteChase.workSurface.destroyedBricks !== offRouteSurfaceBefore.destroyedBricks) throw new Error('Off-centre CHASE destroyed masonry instead of recessing it');
await paintedChase.screenshot({ path: outputPath('desktop-chase-follows-painted-line.png') });
await paintedChase.close();

const routedChase = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await routedChase.goto(baseUrl, { waitUntil: 'networkidle' });
await routedChase.click('#start-button');
await routedChase.waitForTimeout(250);
const initialPaintedPixels = await routedChase.evaluate(() => {
  const game = window.__wireTheHouse;
  const point = game.mission.activePoint;
  const camera = game.renderer.camera;
  const route = [];
  for (let step = 0; step <= 10; step += 1) route.push({ x: -1.95, y: 0.42 + step * 0.055 });
  for (let step = 1; step <= 10; step += 1) route.push({ x: -1.95 + step * 0.05, y: 0.97 });
  for (let step = 1; step <= 10; step += 1) route.push({ x: -1.45, y: 0.97 - step * 0.055 });
  camera.position.set(-1.7, 1.45, -1.45);
  for (const sample of route) {
    camera.lookAt(sample.x, sample.y, -2.41);
    camera.updateMatrixWorld(true);
    game.room.brickWall.spray(camera, point.definition.id, 'live', 0x087fce);
  }
  point.placeAt(route[0].x, route[0].y);
  point.setStage('marked');
  camera.lookAt(-1.7, 0.97, -2.41);
  camera.updateMatrixWorld(true);
  game.step(1 / 60);
  const pixels = game.room.brickWall.livePaintContext.getImageData(0, 0, game.room.brickWall.livePaintCanvas.width, game.room.brickWall.livePaintCanvas.height).data;
  let painted = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) painted += 1;
  return painted;
});
if (initialPaintedPixels < 100) throw new Error(`CHASE route did not create enough visible paint for cleanup regression: ${initialPaintedPixels}`);
await routedChase.keyboard.press('Digit4');
const chasePasses = [];
for (let pass = 1; pass <= 4; pass += 1) {
  chasePasses.push(await routedChase.evaluate(() => {
    const game = window.__wireTheHouse;
    const point = game.mission.activePoint;
    game.renderer.camera.lookAt(-1.7, 0.97, -2.41);
    game.renderer.camera.updateMatrixWorld(true);
    const hit = game.chasing.hit(game.renderer.camera, point);
    game.step(1 / 60);
    const pixels = game.room.brickWall.livePaintContext.getImageData(0, 0, game.room.brickWall.livePaintCanvas.width, game.room.brickWall.livePaintCanvas.height).data;
    let paintedPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) paintedPixels += 1;
    return { hit, paintedPixels, state: JSON.parse(window.render_game_to_text()) };
  }));
  await routedChase.screenshot({ path: outputPath(`desktop-chase-pass-${pass}.png`) });
}
const routedResult = chasePasses.at(-1).state;
for (let index = 0; index < chasePasses.length; index += 1) {
  const pass = chasePasses[index];
  const expectedHits = index + 1;
  const expectedStage = expectedHits === 4 ? 'chased' : 'chasing';
  if (!pass.hit || pass.state.activePoint.chaseHits !== expectedHits || pass.state.activePoint.stage !== expectedStage) {
    throw new Error(`CHASE pass ${expectedHits} was not a separate successful stage: ${JSON.stringify(pass)}`);
  }
  if (index > 0 && pass.state.activePoint.chaseCoverage <= chasePasses[index - 1].state.activePoint.chaseCoverage) {
    throw new Error(`CHASE coverage did not advance on pass ${expectedHits}: ${JSON.stringify(chasePasses.map(item => item.state.activePoint.chaseCoverage))}`);
  }
  if (index > 0 && pass.paintedPixels > chasePasses[index - 1].paintedPixels) {
    throw new Error(`CHASE paint residue increased on pass ${expectedHits}: ${JSON.stringify(chasePasses.map(item => item.paintedPixels))}`);
  }
}
if (chasePasses.at(-1).paintedPixels !== 0 || routedResult.workSurface.freeSprayMarks !== 0) {
  throw new Error(`Completed CHASE left visible spray residue: ${JSON.stringify({ paintedPixels: chasePasses.at(-1).paintedPixels, freeSprayMarks: routedResult.workSurface.freeSprayMarks })}`);
}
if (routedResult.activePoint.stage !== 'chased' || routedResult.activePoint.chaseCoverage < 0.98) throw new Error(`CHASE did not consume the complete painted route: ${JSON.stringify(routedResult)}`);
if (routedResult.workSurface.carvedCells < 20 || routedResult.workSurface.recessedBricks < 5 || routedResult.workSurface.destroyedBricks !== 0 || routedResult.workSurface.chaseMinimumDepthMm > 42 || routedResult.workSurface.chaseMaximumDepthMm < 68 || routedResult.workSurface.chaseBackSurfaces < 20 || routedResult.workSurface.chaseSideWalls < 20 || routedResult.workSurface.deformedWallCells < 10) {
  throw new Error(`CHASE did not form a narrow multi-brick groove: ${JSON.stringify(routedResult.workSurface)}`);
}
const chaseDepthGeometry = await routedChase.evaluate(() => {
  const result = { backs: 0, sides: 0, minimumDepthMm: Number.POSITIVE_INFINITY, maximumDepthMm: 0, solidMaterials: true };
  window.__wireTheHouse.renderer.scene.traverse(object => {
    if (!object.isInstancedMesh || (!object.name.includes('recessed back surfaces') && !object.name.includes('dark chase side walls'))) return;
    const material = object.material;
    result.solidMaterials &&= !material.transparent && material.depthWrite && material.depthTest && material.opacity === 1;
    if (object.name.includes('dark chase side walls')) result.sides += object.count;
    if (object.name.includes('recessed back surfaces')) {
      result.backs += object.count;
      const matrix = object.instanceMatrix.array;
      for (let index = 0; index < object.count; index += 1) {
        const offset = index * 16;
        const depth = Math.round((0.09 - (matrix[offset + 14] + Math.abs(matrix[offset + 10]) / 2)) * 1000);
        result.minimumDepthMm = Math.min(result.minimumDepthMm, depth);
        result.maximumDepthMm = Math.max(result.maximumDepthMm, depth);
      }
    }
  });
  return result;
});
if (chaseDepthGeometry.backs < 20 || chaseDepthGeometry.sides < 20 || chaseDepthGeometry.minimumDepthMm > 42 || chaseDepthGeometry.maximumDepthMm < 68 || chaseDepthGeometry.maximumDepthMm - chaseDepthGeometry.minimumDepthMm < 22 || !chaseDepthGeometry.solidMaterials) {
  throw new Error(`CHASE lacks solid variable-depth back/side geometry: ${JSON.stringify(chaseDepthGeometry)}`);
}
await routedChase.waitForTimeout(300);
await routedChase.screenshot({ path: outputPath('desktop-complete-jagged-chase-route.png') });
await routedChase.evaluate(() => {
  const game = window.__wireTheHouse;
  game.renderer.camera.position.set(-0.82, 1.32, -0.92);
  game.renderer.camera.lookAt(-1.7, 0.82, -2.465);
  game.renderer.camera.updateMatrixWorld(true);
  game.renderer.render();
});
await routedChase.screenshot({ path: outputPath('desktop-chase-depth-oblique.png') });
await routedChase.close();

const desktop = await browser.newPage({ viewport: { width: 1792, height: 864 } });
desktop.on('console', message => { if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`); });
desktop.on('pageerror', error => errors.push(`desktop page: ${error.message}`));
const response = await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
if (!response?.ok()) throw new Error(`Route did not load: ${response?.status()}`);
await desktop.click('#start-button');
await desktop.waitForTimeout(450);
const paintLayerContract = await desktop.evaluate(() => {
  const game = window.__wireTheHouse;
  const paint = game.room.brickWall.getObjectByName('Continuous live spray paint surface');
  const rigMaterials = [];
  game.fpsRig.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const item of materials) rigMaterials.push({ transparent: item.transparent, depthWrite: item.depthWrite });
  });
  return {
    paintDepthTest: paint?.material?.depthTest,
    rigMaterials,
  };
});
if (paintLayerContract.paintDepthTest !== true || paintLayerContract.rigMaterials.some(item => !item.transparent || item.depthWrite)) {
  throw new Error(`Spray/viewmodel render layering is unsafe: ${JSON.stringify(paintLayerContract)}`);
}
if (!await desktop.locator('#desktop-key-guide').isVisible()) throw new Error('Desktop key guide is not visible during gameplay');
const keyGuideText = await desktop.locator('#desktop-key-guide').innerText();
for (const required of ['WASD', 'LMB', 'E', 'WHEEL', '1–6', 'V', 'C', 'X', 'F', 'ESC']) {
  if (!keyGuideText.includes(required)) throw new Error(`Desktop key guide is missing ${required}`);
}
const beforeMove = await state(desktop);
await desktop.mouse.move(680, 380);
await desktop.mouse.move(740, 330);
const afterLook = await state(desktop);
if (afterLook.player.yaw === beforeMove.player.yaw || afterLook.player.pitch === beforeMove.player.pitch) throw new Error('Desktop Pointer Lock mouse look did not update yaw and pitch');
const beforePointerSpike = await state(desktop);
await desktop.evaluate(() => {
  document.dispatchEvent(new MouseEvent('mousemove', { movementX: 2400, movementY: -1800, bubbles: true }));
});
const afterPointerSpike = await state(desktop);
if (afterPointerSpike.player.yaw !== beforePointerSpike.player.yaw || afterPointerSpike.player.pitch !== beforePointerSpike.player.pitch) {
  throw new Error(`Desktop mouse look accepted an implausible Pointer Lock spike: ${JSON.stringify({ before: beforePointerSpike.player, after: afterPointerSpike.player })}`);
}
await desktop.mouse.wheel(0, 120);
if ((await state(desktop)).mission.selectedTool !== 'hammer') throw new Error('Desktop mouse wheel did not cycle the visible work tool');
await desktop.keyboard.press('Digit3');
await aimAtActive(desktop);
await leftClickAction(desktop);
if ((await state(desktop)).activePoint.stage !== 'marked') throw new Error('Desktop left mouse did not use the selected tool');
if ((await state(desktop)).workSurface.sprayMode !== 'live') throw new Error('Realistic LIVE spray is not the default method');
await desktop.keyboard.press('KeyV');
if ((await state(desktop)).workSurface.sprayMode !== 'dots') throw new Error('Desktop could not retain the alternative DOTS method');
await desktop.keyboard.press('KeyV');
await desktop.keyboard.press('KeyC');
const liveSettings = await state(desktop);
if (liveSettings.workSurface.sprayMode !== 'live' || liveSettings.workSurface.sprayColor !== 'RED') throw new Error(`Desktop spray settings did not change: ${JSON.stringify(liveSettings.workSurface)}`);
const liveMarksBefore = liveSettings.workSurface.freeSprayMarks;
await desktop.mouse.down({ button: 'left' });
for (let index = 0; index < 7; index += 1) {
  await desktop.evaluate(step => {
    const game = window.__wireTheHouse;
    game.player.pitch -= 0.012 * step;
    window.advanceTime(90);
  }, index);
}
await desktop.screenshot({ path: outputPath('desktop-live-red-spray.png') });
await desktop.evaluate(() => document.exitPointerLock());
await desktop.waitForTimeout(80);
const afterPointerUnlock = await desktop.evaluate(() => ({
  held: window.__wireTheHouse.input.actionHeld,
  requested: window.__wireTheHouse.input.actionRequested,
  marks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks,
  locked: Boolean(document.pointerLockElement),
}));
await desktop.evaluate(() => window.advanceTime(220));
const marksAfterUnlockedTime = (await state(desktop)).workSurface.freeSprayMarks;
if (afterPointerUnlock.locked || afterPointerUnlock.held || afterPointerUnlock.requested || marksAfterUnlockedTime !== afterPointerUnlock.marks) {
  throw new Error(`Releasing Pointer Lock left spray input active: ${JSON.stringify({ afterPointerUnlock, marksAfterUnlockedTime })}`);
}
await desktop.mouse.up({ button: 'left' });
const marksBeforeRightClick = (await state(desktop)).workSurface.freeSprayMarks;
await desktop.locator('#game-canvas').click({ button: 'right', position: { x: 650, y: 300 } });
await desktop.waitForTimeout(80);
await desktop.evaluate(() => window.advanceTime(220));
const afterRightClick = await desktop.evaluate(() => ({
  held: window.__wireTheHouse.input.actionHeld,
  requested: window.__wireTheHouse.input.actionRequested,
  marks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks,
  locked: document.pointerLockElement === document.querySelector('#game-canvas'),
}));
if (!afterRightClick.locked || afterRightClick.held || afterRightClick.requested || afterRightClick.marks !== marksBeforeRightClick) {
  throw new Error(`Right mouse must only restore Pointer Lock, never spray: ${JSON.stringify({ marksBeforeRightClick, afterRightClick })}`);
}
await desktop.evaluate(() => {
  const game = window.__wireTheHouse;
  game.player.yaw += 0.24;
  game.renderer.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
  game.step(1 / 60);
});
await desktop.screenshot({ path: outputPath('desktop-spray-viewmodel-occlusion.png') });
const liveMarksAfter = afterPointerUnlock.marks;
if (liveMarksAfter - liveMarksBefore < 5) throw new Error(`LIVE spray did not record a continuous held stroke: ${liveMarksAfter - liveMarksBefore} samples`);
await desktop.keyboard.press('Digit4');
await aimAtActive(desktop);
await unlockedLeftClickAction(desktop, 800);
const heldHammerState = await state(desktop);
if (heldHammerState.activePoint.stage !== 'chasing' || heldHammerState.activePoint.chaseHits !== 1) throw new Error(`Holding desktop left mouse repeated the hammer instead of making one chase pass: ${JSON.stringify(heldHammerState)}`);
for (let pass = 0; pass < 3; pass += 1) await leftClickAction(desktop);
if ((await state(desktop)).activePoint.stage !== 'chased') throw new Error(`Four separate desktop hammer presses did not complete CHASE: ${JSON.stringify(await state(desktop))}`);
const surfaceBeforeDesktopDemolish = (await state(desktop)).workSurface;
await desktop.keyboard.press('KeyX');
await desktop.waitForTimeout(140);
await desktop.evaluate(() => {
  const game = window.__wireTheHouse;
  game.renderer.camera.position.set(0.8, 1.65, -0.35);
  const target = game.room.brickWall.targets.find(item => !item.destroyed && Math.abs(item.center.x - 0.8) < 0.2 && Math.abs(item.center.y - 1.65) < 0.2);
  if (!target) throw new Error('Could not select a centred desktop demolition brick');
  game.renderer.camera.lookAt(target.center);
  game.player.yaw = game.renderer.camera.rotation.y;
  game.player.pitch = game.renderer.camera.rotation.x;
  game.step(1 / 60);
});
await desktop.mouse.down({ button: 'left' });
await desktop.evaluate(() => {
  const game = window.__wireTheHouse;
  // Pointer Lock can report a synthetic mouse delta when a headless browser
  // restores capture. Lock the QA ray before advancing the held demolition.
  game.renderer.camera.position.set(0.8, 1.65, -0.35);
  const target = game.room.brickWall.targets.find(item => !item.destroyed && Math.abs(item.center.x - 0.8) < 0.2 && Math.abs(item.center.y - 1.65) < 0.2);
  if (!target) throw new Error('Could not retain the centred desktop demolition brick');
  game.renderer.camera.lookAt(target.center);
  game.player.yaw = game.renderer.camera.rotation.y;
  game.player.pitch = game.renderer.camera.rotation.x;
  window.advanceTime(900);
});
await desktop.mouse.up({ button: 'left' });
const surfaceAfterDesktopDemolish = (await state(desktop)).workSurface;
if (surfaceAfterDesktopDemolish.destroyedBricks !== surfaceBeforeDesktopDemolish.destroyedBricks || surfaceAfterDesktopDemolish.maximumDemolitionDepthMm < 12 || surfaceAfterDesktopDemolish.maximumDemolitionDepthMm >= 100) throw new Error(`Desktop hold should accumulate a partial crater without punching through the wall in 900 ms: ${JSON.stringify(await state(desktop))}`);
await desktop.keyboard.press('Digit5');
await aimAtActive(desktop);
const beforeDesktopFitting = await state(desktop);
await leftClickAction(desktop);
const afterDesktopFitting = await state(desktop);
if (afterDesktopFitting.activePoint.stage !== 'fitted') throw new Error(`FITTING did not work exactly once from desktop left click: ${JSON.stringify({ beforeDesktopFitting, afterDesktopFitting })}`);
await desktop.evaluate(() => window.advanceTime(200));
await leftClickAction(desktop);
if ((await state(desktop)).activePoint.stage !== 'mortared') throw new Error('Second FITTING action did not apply mortar from desktop left click');
await desktop.reload({ waitUntil: 'networkidle' });
await desktop.click('#start-button');
await desktop.waitForTimeout(450);
await desktop.keyboard.press('Digit3');
await desktop.keyboard.down('KeyS');
await desktop.evaluate(() => window.advanceTime(500));
await desktop.keyboard.up('KeyS');
const afterMove = await state(desktop);
if (Math.abs(afterMove.player.z - beforeMove.player.z) < 0.25) throw new Error('Desktop WASD movement did not move the player');

for (const id of ['A', 'B', 'C']) {
  await aimAtActive(desktop);
  const aimed = await state(desktop);
  if (!aimed.activePoint.targeted || aimed.activePoint.id !== id) throw new Error(`Could not target Point ${id}`);
  await reachLeveling(desktop);
  if (id === 'A') {
    const pointerLocked = await desktop.evaluate(() => Boolean(document.pointerLockElement));
    if (pointerLocked) throw new Error('Pointer lock was not released when leveling opened');
    const tiltBeforeButtons = (await state(desktop)).activePoint.tiltDegrees;
    await desktop.locator('[data-level="left"]').click();
    const tiltAfterLeft = (await state(desktop)).activePoint.tiltDegrees;
    if (tiltAfterLeft >= tiltBeforeButtons) throw new Error('LEFT leveling button is not clickable');
    await desktop.locator('[data-level="right"]').click();
    const tiltAfterRight = (await state(desktop)).activePoint.tiltDegrees;
    if (Math.abs(tiltAfterRight - tiltBeforeButtons) > 0.01) throw new Error('RIGHT leveling button is not clickable');
    await desktop.locator('#game-shell').dispatchEvent('pointerdown', { button: 2, pointerType: 'mouse' });
    await desktop.evaluate(() => window.advanceTime(34));
    if ((await state(desktop)).activePoint.stage !== 'mortared') throw new Error('Right mouse did not exit leveling mode');
    await aimAtActive(desktop);
    await action(desktop);
    if ((await state(desktop)).activePoint.stage !== 'leveling') throw new Error('Could not resume leveling after right-mouse exit');
  }
  if (id === 'A' || id === 'C') {
    for (let index = 0; index < 3; index += 1) await desktop.keyboard.press('KeyA');
    for (let index = 0; index < 2; index += 1) await desktop.keyboard.press('KeyW');
  } else {
    for (let index = 0; index < 2; index += 1) await desktop.keyboard.press('KeyD');
    for (let index = 0; index < 2; index += 1) await desktop.keyboard.press('KeyS');
  }
  const aligned = await state(desktop);
  if (!aligned.activePoint.levelPass || !aligned.activePoint.flushPass) throw new Error(`Point ${id} leveling did not reach both tolerances`);
  await action(desktop);
  await finishPipe(desktop);
  await desktop.screenshot({ path: outputPath(`desktop-point-${id}.png`) });
}
const complete = await state(desktop);
if (!complete.mission.complete || complete.mode !== 'mission-complete') throw new Error('Mission did not reach FIRST FIX COMPLETE');
if (!await desktop.locator('#result-panel.visible').isVisible()) throw new Error('Result panel is not visible');

const mobileDemolition = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
await mobileDemolition.goto(baseUrl, { waitUntil: 'networkidle' });
await mobileDemolition.click('#start-button');
await mobileDemolition.waitForTimeout(250);
await mobileTap(mobileDemolition, '[data-tool="hammer"]');
await mobileTap(mobileDemolition, '#tool-mode-toggle');
const mobileHeldDemolition = await mobileDemolition.evaluate(() => {
  const game = window.__wireTheHouse;
  game.renderer.camera.position.set(0.8, 1.65, -0.35);
  const target = game.room.brickWall.targets.find(item => !item.destroyed && Math.abs(item.center.x - 0.8) < 0.2 && Math.abs(item.center.y - 1.65) < 0.2);
  if (!target) throw new Error('Could not select a centred mobile demolition brick');
  game.renderer.camera.lookAt(target.center);
  game.player.yaw = game.renderer.camera.rotation.y;
  game.player.pitch = game.renderer.camera.rotation.x;
  const look = document.querySelector('#look-joystick');
  const rect = look.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const dispatch = (type, clientX) => look.dispatchEvent(new PointerEvent(type, { pointerId: 990, pointerType: 'touch', clientX, clientY: y, bubbles: true, cancelable: true }));
  dispatch('pointerdown', x);
  dispatch('pointermove', x + 6);
  window.advanceTime(900);
  const during = {
    held: game.input.actionHeld,
    surface: JSON.parse(window.render_game_to_text()).workSurface,
    damagedTargets: game.room.brickWall.targets.filter(item => item.damage > 0 || item.destroyed).map(item => ({ id: item.id, damage: item.damage, destroyed: item.destroyed })),
  };
  dispatch('pointerup', x + 6);
  window.advanceTime(34);
  return { during, heldAfterRelease: game.input.actionHeld };
});
if (!mobileHeldDemolition.during.held || mobileHeldDemolition.during.surface.destroyedBricks !== 0 || mobileHeldDemolition.during.surface.maximumDemolitionDepthMm < 12 || mobileHeldDemolition.during.surface.maximumDemolitionDepthMm >= 100 || mobileHeldDemolition.heldAfterRelease) {
  throw new Error(`Mobile hold did not continuously DEMOLISH and release cleanly: ${JSON.stringify(mobileHeldDemolition)}`);
}
await mobileDemolition.screenshot({ path: outputPath('mobile-held-demolition.png') });
await mobileDemolition.close();

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
mobile.on('console', message => { if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`); });
mobile.on('pageerror', error => errors.push(`mobile page: ${error.message}`));
await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
await mobile.click('#start-button');
await mobile.waitForTimeout(450);
if (await mobile.locator('#desktop-key-guide').isVisible()) throw new Error('Desktop key guide overlaps the mobile HUD');
for (const selector of ['#joystick', '#look-joystick', '[data-tool="spray"]', '[data-tool="hammer"]', '[data-tool="fitting"]', '[data-tool="level"]', '[data-tool="spring"]', '[data-tool="cutter"]', '#settings-toggle', '#tool-mode-toggle']) {
  const box = await mobile.locator(selector).boundingBox();
  if (!box || box.width < 44 || box.height < 44) throw new Error(`${selector} is below the 44px touch target`);
}
if (await mobile.locator('button#mobile-action, #tool-prev, #tool-next').count()) throw new Error('Legacy mobile ACTION or previous/next tool buttons still exist');
if (await mobile.locator('#tool-status').isVisible()) throw new Error('Selected-tool badge still overlaps the right joystick');
await mobileTap(mobile, '#tool-mode-toggle');
if ((await state(mobile)).workSurface.sprayMode !== 'dots') throw new Error('Context mode button did not select DOTS');
await mobileTap(mobile, '#tool-mode-toggle');
if ((await state(mobile)).workSurface.sprayMode !== 'live') throw new Error('Context mode button did not restore LIVE');
if (await mobile.locator('#settings-panel').isVisible()) throw new Error('Settings panel covers gameplay before it is opened');
await mobileTap(mobile, '#settings-toggle');
await mobile.waitForTimeout(220);
if (!await mobile.locator('#settings-panel').isVisible()) throw new Error('Settings icon did not open the settings panel');
for (const selector of ['#spray-color', '#aim-input-mode', '#aim-control-mode', '#aim-speed', '#wall-assist', '#settings-close']) {
  const box = await mobile.locator(selector).boundingBox();
  if (!box || box.width < 44 || box.height < 44) throw new Error(`${selector} is below the 44px settings touch target`);
}
await mobileTap(mobile, '#spray-color');
await mobileTap(mobile, '#aim-input-mode');
if ((await state(mobile)).workSurface.aimInputMode !== 'stick') throw new Error('Settings did not expose the classic velocity stick fallback');
await mobileTap(mobile, '#aim-input-mode');
if ((await state(mobile)).workSurface.aimInputMode !== 'drag') throw new Error('Settings did not restore direct drag aiming');
await mobileTap(mobile, '#aim-control-mode');
if ((await state(mobile)).workSurface.aimControlMode !== 'double-tap') throw new Error('Settings did not retain classic 2× HOLD aim control');
await mobileTap(mobile, '#aim-control-mode');
for (const expected of ['fast', 'precise', 'normal']) {
  await mobileTap(mobile, '#aim-speed');
  if ((await state(mobile)).workSurface.aimProfile !== expected) throw new Error(`Aim speed did not cycle to ${expected}`);
}
await mobileTap(mobile, '#wall-assist');
if ((await state(mobile)).workSurface.wallAssist !== false) throw new Error('Wall precision assist did not switch off');
await mobileTap(mobile, '#wall-assist');
const mobileSpraySettings = await state(mobile);
if (mobileSpraySettings.workSurface.sprayMode !== 'live' || mobileSpraySettings.workSurface.sprayColor !== 'RED' || mobileSpraySettings.workSurface.aimControlMode !== 'auto-use') throw new Error(`Mobile settings did not change: ${JSON.stringify(mobileSpraySettings.workSurface)}`);
await mobile.screenshot({ path: outputPath('mobile-spray-controls.png') });
await mobileTap(mobile, '#settings-close');
if (await mobile.locator('#settings-panel').isVisible()) throw new Error('Settings close button did not dismiss the panel');
for (const tool of ['spray', 'hammer', 'fitting', 'level', 'spring', 'cutter']) {
  await mobileTap(mobile, `[data-tool="${tool}"]`);
  if ((await state(mobile)).mission.selectedTool !== tool) throw new Error(`Could not select ${tool} for viewmodel QA`);
  await mobile.screenshot({ path: outputPath(`mobile-tool-${tool}.png`) });
}
const cancelledOneShot = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'fitting' }));
  game.input.actionRequested = false;
  const look = document.querySelector('#look-joystick');
  const rect = look.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  look.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 880, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  look.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 880, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  return game.input.actionRequested;
});
if (cancelledOneShot) throw new Error('Cancelled drag incorrectly used a one-shot tool');
await mobileTap(mobile, '[data-tool="hammer"]');
if (!await mobile.locator('#tool-mode-toggle').isVisible() || !((await mobile.locator('#tool-mode-toggle').innerText()).includes('CHASE'))) throw new Error('Hammer contextual CHASE mode is not visible');
await mobileTap(mobile, '#tool-mode-toggle');
if ((await state(mobile)).workSurface.hammerMode !== 'demolish') throw new Error('Context mode button did not select DEMOLISH');
await mobileTap(mobile, '#tool-mode-toggle');
await mobileTap(mobile, '[data-tool="spray"]');
const proximityAssist = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const sample = distance => {
    game.renderer.camera.position.z = -2.41 + distance;
    game.player.yaw = 0;
    game.player.pitch = 0;
    game.input.resetMobileLook();
    game.player.update(0);
    game.player.lookMobileDrag(100, 100);
    return { yaw: Math.abs(game.player.yaw), pitch: Math.abs(game.player.pitch), assist: game.player.wallAssistAmount };
  };
  const far = sample(2.1);
  const near = sample(.72);
  game.input.resetMobileLook();
  return { far, near };
});
if (proximityAssist.far.assist > .1 || proximityAssist.near.assist < .7 || proximityAssist.near.yaw >= proximityAssist.far.yaw * .75 || proximityAssist.near.pitch >= proximityAssist.far.pitch * .75) throw new Error(`Wall proximity did not blend into precision aiming: ${JSON.stringify(proximityAssist)}`);
const mobileLayout = await mobile.evaluate(() => {
  const shell = document.querySelector('#game-shell').getBoundingClientRect();
  return { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, scrollHeight: document.documentElement.scrollHeight, shellHeight: shell.height, footerCount: document.querySelectorAll('.page-footer').length };
});
if (mobileLayout.scrollWidth > mobileLayout.innerWidth || mobileLayout.bodyScrollWidth > mobileLayout.innerWidth || mobileLayout.scrollHeight !== mobileLayout.innerHeight || Math.abs(mobileLayout.shellHeight - mobileLayout.innerHeight) > 1 || mobileLayout.footerCount !== 0) throw new Error(`Mobile viewport is clipped or overflowing: ${JSON.stringify(mobileLayout)}`);
const touchResult = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const shell = document.querySelector('#game-shell');
  const before = { yaw: game.player.yaw, pitch: game.player.pitch, scrollY };
  const dispatch = (type, x, y) => {
    const event = new PointerEvent(type, { pointerId: 91, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true });
    const accepted = shell.dispatchEvent(event);
    return { accepted, defaultPrevented: event.defaultPrevented };
  };
  const down = dispatch('pointerdown', 260, 300);
  const move = dispatch('pointermove', 215, 235);
  dispatch('pointerup', 215, 235);
  return { before, after: { yaw: game.player.yaw, pitch: game.player.pitch, scrollY }, down, move, shellTouchAction: getComputedStyle(shell).touchAction };
});
if (touchResult.after.pitch === touchResult.before.pitch || touchResult.after.yaw === touchResult.before.yaw) throw new Error('Mobile swipe did not update yaw and pitch');
const mobileButtonStyles = await mobile.evaluate(() => {
  const button = document.querySelector('[data-tool="spray"]');
  const style = getComputedStyle(button);
  const child = button.querySelector('span');
  const childStyle = getComputedStyle(child);
  const selectEvent = new Event('selectstart', { bubbles: true, cancelable: true });
  child.dispatchEvent(selectEvent);
  return { tapHighlight: style.webkitTapHighlightColor, userSelect: style.userSelect, webkitUserSelect: style.webkitUserSelect, childUserSelect: childStyle.userSelect, childWebkitUserSelect: childStyle.webkitUserSelect, touchCallout: childStyle.webkitTouchCallout || 'unsupported', touchAction: style.touchAction, selectPrevented: selectEvent.defaultPrevented };
});
if (!['rgba(0, 0, 0, 0)', 'transparent'].includes(mobileButtonStyles.tapHighlight) || mobileButtonStyles.userSelect !== 'none' || mobileButtonStyles.webkitUserSelect !== 'none' || mobileButtonStyles.childUserSelect !== 'none' || mobileButtonStyles.childWebkitUserSelect !== 'none' || !['none', 'unsupported'].includes(mobileButtonStyles.touchCallout) || mobileButtonStyles.touchAction !== 'manipulation' || !mobileButtonStyles.selectPrevented) throw new Error(`Game UI allows browser highlight or selection: ${JSON.stringify(mobileButtonStyles)}`);
await aimAtActive(mobile);
const autoAimUse = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const shell = document.querySelector('#look-joystick');
  window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'spray' }));
  const rect = shell.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const dispatch = (type, pointerId, clientX, clientY) => shell.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX, clientY, bubbles: true, cancelable: true }));
  const marksBefore = JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks;
  dispatch('pointerdown', 172, x, y);
  const yawBefore = game.player.yaw;
  dispatch('pointermove', 172, x - rect.width * .4, y + rect.height * .08);
  const heldImmediately = game.input.actionHeld;
  const yawAfterMove = game.player.yaw;
  window.advanceTime(360);
  const during = { held: game.input.actionHeld, yaw: game.player.yaw, yawDrift: Math.abs(game.player.yaw - yawAfterMove), marks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks };
  dispatch('pointerup', 172, x - rect.width * .4, y + rect.height * .08);
  return { marksBefore, yawBefore, heldImmediately, during, heldAfter: game.input.actionHeld, inputMode: game.aimInputMode, thumbDisplay: getComputedStyle(document.querySelector('#look-joystick-thumb')).display };
});
if (autoAimUse.inputMode !== 'drag' || autoAimUse.thumbDisplay !== 'none' || !autoAimUse.heldImmediately || !autoAimUse.during.held || autoAimUse.heldAfter || Math.abs(autoAimUse.during.yaw - autoAimUse.yawBefore) < 0.05 || autoAimUse.during.yawDrift > 0.001 || autoAimUse.during.marks <= autoAimUse.marksBefore) throw new Error(`Direct drag aim did not track and stop with the finger: ${JSON.stringify(autoAimUse)}`);
if (!touchResult.move.defaultPrevented || touchResult.shellTouchAction !== 'none') throw new Error('Game touch-look did not suppress browser scrolling');
if (touchResult.after.scrollY !== touchResult.before.scrollY) throw new Error('Viewport scrolled during game camera swipe');
const mobileBeforeMove = await state(mobile);
await mobile.evaluate(async () => {
  const shell = document.querySelector('#game-shell');
  const joystick = document.querySelector('#joystick');
  const rect = joystick.getBoundingClientRect();
  const dispatch = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId: 92, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(joystick, 'pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2);
  dispatch(joystick, 'pointermove', rect.left + rect.width / 2, rect.top + rect.height * .2);
  await window.advanceTime(450);
  dispatch(joystick, 'pointerup', rect.left + rect.width / 2, rect.top + rect.height * .2);
});
const mobileAfterMove = await state(mobile);
if (Math.hypot(mobileAfterMove.player.x - mobileBeforeMove.player.x, mobileAfterMove.player.z - mobileBeforeMove.player.z) < 0.2) throw new Error('Mobile joystick did not move the player');
const dualStickCheck = await mobile.evaluate(() => {
  const game = window.__wireTheHouse;
  const move = document.querySelector('#joystick');
  const look = document.querySelector('#look-joystick');
  const moveRect = move.getBoundingClientRect();
  const lookRect = look.getBoundingClientRect();
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const before = { position: game.renderer.camera.position.clone(), yaw: game.player.yaw, marks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks };
  dispatch(move, 'pointerdown', 191, moveRect.left + moveRect.width / 2, moveRect.top + moveRect.height / 2);
  dispatch(move, 'pointermove', 191, moveRect.left + moveRect.width / 2, moveRect.top + 8);
  dispatch(look, 'pointerdown', 192, lookRect.left + lookRect.width / 2, lookRect.top + lookRect.height / 2);
  dispatch(look, 'pointermove', 192, lookRect.right - 8, lookRect.top + lookRect.height / 2);
  window.advanceTime(400);
  const active = { distance: before.position.distanceTo(game.renderer.camera.position), yawDelta: Math.abs(game.player.yaw - before.yaw), move: { ...game.input.mobileMove }, look: { ...game.input.mobileLook }, held: game.input.actionHeld, sprayMarks: JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks - before.marks };
  dispatch(move, 'pointerup', 191, moveRect.left + moveRect.width / 2, moveRect.top + 8);
  dispatch(look, 'pointerup', 192, lookRect.right - 8, lookRect.top + lookRect.height / 2);
  return { active, released: { move: { ...game.input.mobileMove }, look: { ...game.input.mobileLook } } };
});
if (dualStickCheck.active.distance < 0.2 || dualStickCheck.active.yawDelta < 0.1 || dualStickCheck.active.move.y === 0 || !dualStickCheck.active.held || dualStickCheck.active.sprayMarks < 1) throw new Error(`Move joystick plus drag aim did not produce simultaneous move, aim, and spray: ${JSON.stringify(dualStickCheck)}`);
if (dualStickCheck.released.move.x !== 0 || dualStickCheck.released.move.y !== 0 || dualStickCheck.released.look.x !== 0 || dualStickCheck.released.look.y !== 0) throw new Error(`Dual joysticks did not reset independently: ${JSON.stringify(dualStickCheck)}`);
const simultaneousToolCheck = await mobile.evaluate(async () => {
  const game = window.__wireTheHouse;
  const joystick = document.querySelector('#joystick');
  const next = document.querySelector('[data-tool="hammer"]');
  const rect = joystick.getBoundingClientRect();
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(joystick, 'pointerdown', 193, rect.left + rect.width / 2, rect.top + rect.height / 2);
  dispatch(joystick, 'pointermove', 193, rect.left + rect.width / 2, rect.top + 8);
  dispatch(next, 'pointerdown', 194, 320, 760);
  const before = game.renderer.camera.position.clone();
  window.advanceTime(500);
  const whilePressed = { distance: before.distanceTo(game.renderer.camera.position), move: { ...game.input.mobileMove }, tool: game.selectedTool };
  dispatch(next, 'pointerup', 194, 320, 760);
  dispatch(joystick, 'pointerup', 193, rect.left + rect.width / 2, rect.top + 8);
  return { whilePressed, afterRelease: { ...game.input.mobileMove } };
});
if (simultaneousToolCheck.whilePressed.distance < 0.02 || simultaneousToolCheck.whilePressed.move.y === 0) throw new Error(`Tool press interrupted joystick movement: ${JSON.stringify(simultaneousToolCheck)}`);
if (simultaneousToolCheck.afterRelease.x !== 0 || simultaneousToolCheck.afterRelease.y !== 0) throw new Error(`Joystick did not reset after its own pointer ended: ${JSON.stringify(simultaneousToolCheck)}`);
await mobileTap(mobile, '[data-tool="spray"]');
await aimAtActive(mobile);
await mobileAimAction(mobile);
if ((await state(mobile)).activePoint.stage !== 'marked') throw new Error('Mobile ACTION did not mark the point');
if ((await state(mobile)).workSurface.freeSprayMarks < 1) throw new Error('Free spray did not create a visible wall mark');
const graffiti = await mobile.evaluate(() => {
  const look = document.querySelector('#look-joystick');
  const rect = look.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dispatch = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  dispatch(look, 'pointerdown', 201, centerX, centerY);
  dispatch(look, 'pointerup', 201, centerX, centerY);
  dispatch(look, 'pointerdown', 202, centerX, centerY);
  for (const [x, y] of [[.12, -.08], [.2, -.12], [.28, -.16], [.34, -.18]]) {
    dispatch(look, 'pointermove', 202, centerX + rect.width * x, centerY + rect.height * y);
    window.advanceTime(100);
  }
  dispatch(look, 'pointerup', 202, centerX + rect.width * .34, centerY - rect.height * .18);
  return JSON.parse(window.render_game_to_text()).workSurface.freeSprayMarks;
});
if (graffiti < 4) throw new Error(`Held mobile spray did not paint a free stroke: ${graffiti} marks`);
await mobile.screenshot({ path: outputPath('mobile-free-spray.png') });
await mobile.waitForTimeout(1350);
if (await mobile.locator('#interaction-prompt.visible').isVisible()) throw new Error('Action notification did not dismiss after its short timeout');
await mobileTap(mobile, '[data-tool="hammer"]');
await aimAtActive(mobile);
for (let index = 0; index < 4; index += 1) await mobileAimAction(mobile);
await mobile.screenshot({ path: outputPath('mobile-chase-depth.png') });
await mobileTap(mobile, '[data-tool="fitting"]');
if (await mobile.locator('#tool-mode-toggle').isVisible() || await mobile.locator('#tool-status').isVisible()) throw new Error('FITTING or an irrelevant mode button still overlaps the right joystick');
await aimAtActive(mobile);
await mobileAimAction(mobile);
await mobileAimAction(mobile);
await mobileTap(mobile, '[data-tool="level"]');
await mobileAimAction(mobile);
if ((await state(mobile)).activePoint.stage !== 'leveling') throw new Error(`Mobile AIM center action did not reach leveling mode: ${JSON.stringify(await state(mobile))}`);
for (let index = 0; index < 3; index += 1) await mobileTap(mobile, '[data-level="left"]');
for (let index = 0; index < 2; index += 1) await mobileTap(mobile, '[data-level="in"]');
const mobileLevel = await state(mobile);
if (!mobileLevel.activePoint.levelPass || !mobileLevel.activePoint.flushPass) throw new Error('Mobile leveling controls did not affect the actual 3D group');
await mobile.screenshot({ path: outputPath('mobile-leveling.png') });
await mobileTap(mobile, '[data-level="confirm"]');
if ((await state(mobile)).activePoint.stage !== 'leveled') throw new Error('Mobile CONFIRM did not pass leveling');
await mobile.screenshot({ path: outputPath('mobile-entry.png') });

await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
console.log(JSON.stringify({ desktop: { movementDeltaZ: Number((afterMove.player.z - beforeMove.player.z).toFixed(2)), pointerLook: true, mouseWheelToolChange: true, missionComplete: complete.mission.complete, points: complete.points }, mobile: { ...touchResult, layout: mobileLayout, aimInput: autoAimUse.inputMode, dragYawDrift: autoAimUse.during.yawDrift, joystickDistance: Number(Math.hypot(mobileAfterMove.player.x - mobileBeforeMove.player.x, mobileAfterMove.player.z - mobileBeforeMove.player.z).toFixed(2)), autoUseImmediate: autoAimUse.heldImmediately, simultaneousSprayMarks: dualStickCheck.active.sprayMarks, proximityAssist, levelingPassed: true } }, null, 2));
