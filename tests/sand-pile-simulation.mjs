import assert from 'node:assert/strict';
import { createServer } from 'vite';

const maximumSurfaceSlope = pile => {
  const position = pile.geometry.getAttribute('position');
  let steepest = 0;
  for (let row = 0; row < pile.rows; row++) for (let col = 0; col < pile.columns; col++) {
    const i = row * pile.columns + col;
    if (col + 1 < pile.columns) steepest = Math.max(steepest, Math.abs(position.getY(i) - position.getY(i + 1)) / pile.dx);
    if (row + 1 < pile.rows) steepest = Math.max(steepest, Math.abs(position.getY(i) - position.getY(i + pile.columns)) / pile.dz);
  }
  return steepest;
};

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
try {
  const THREE = await vite.ssrLoadModule('/node_modules/three/build/three.module.js');
  const { SandPileSimulation } = await vite.ssrLoadModule('/src/world/SandPileSimulation.ts');
  const pile = new SandPileSimulation(new THREE.MeshStandardMaterial(), 600);
  assert(Math.abs(pile.telemetry.surfaceKg - 600) < .02, 'Initial surface volume corresponds to 600 kg of dry bulk sand');
  const initialSlope = maximumSurfaceSlope(pile);
  assert(initialSlope < pile.maxSlope + .04, `The textured initial deposit remains near dry sand repose: ${initialSlope}`);
  const left = pile.heightAt(-.30, 0), right = pile.heightAt(.30, 0);
  assert(pile.scoop(-.30, 0, 2.24), 'A shovel removes one 1.4 L load');
  assert(pile.heightAt(-.30, 0) < left - .004, 'The blade cuts a visible local depression');
  assert(Math.abs(pile.heightAt(.30, 0) - right) < .001, 'A distant mound region does not collapse when one scoop is taken');
  const grains = pile.getObjectByName('Loose surface grains from the shovel cut');
  const grainPositions = grains.geometry.getAttribute('position');
  const averageGrainRadius = () => {
    let sum = 0;
    for (let i = 0; i < grainPositions.count; i++) sum += Math.hypot(grainPositions.getX(i) + .30, grainPositions.getZ(i));
    return sum / grainPositions.count;
  };
  const initialGrainRadius = averageGrainRadius();
  for (let i = 0; i < 3; i++) pile.update(1 / 60);
  assert(averageGrainRadius() < initialGrainRadius, 'Surface grains move into the cut instead of spraying away from it');
  for (let i = 3; i < 30; i++) pile.update(1 / 60);
  assert(Math.abs(pile.telemetry.surfaceKg - 597.76) < .03, 'Relaxation conserves the remaining sand mass');
  assert.equal(pile.telemetry.remainingKg, 597.76);
  assert(pile.heightAt(-.30, 0) < left, 'The excavated area remains locally depleted after the surface flows');
  const cutCol = Math.round((-.30 / pile.width + .5) * (pile.columns - 1));
  const cutRow = Math.round((0 / pile.depth + .5) * (pile.rows - 1));
  const cutIndex = cutRow * pile.columns + cutCol;
  const freshCutShade = pile.geometry.getAttribute('color').getX(cutIndex);
  for (let i = 0; i < 170; i++) pile.update(1 / 60);
  const settledCutShade = pile.geometry.getAttribute('color').getX(cutIndex);
  assert(settledCutShade > freshCutShade + .03, 'Temporary exposed-sand darkening fades after the surface settles');
  assert(Math.abs(pile.telemetry.surfaceKg - 597.76) < .03, 'Visual settling cannot change the retained sand mass');
  const firstPitM = left - pile.heightAt(-.30, 0);
  const steepest = maximumSurfaceSlope(pile);
  assert(steepest < pile.maxSlope + .04, `A settled cut cannot keep an implausibly steep dry-sand face: ${steepest}`);
  for (let i = 0; i < 10; i++) { assert(pile.scoop(.28, .09, 2.24)); for (let n = 0; n < 25; n++) pile.update(1 / 60); }
  assert(Math.abs(pile.telemetry.surfaceKg - (600 - 11 * 2.24)) < .06, 'Repeated shoveling preserves the bulk balance');
  assert(pile.scoop(0, 0, 700) === false, 'An impossible scoop cannot remove more than the pile owns');
  const position = pile.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) assert(position.getY(i) >= -.00401, 'Relaxation never creates negative sand');
  let loads = 0;
  while (pile.telemetry.remainingKg > 1e-5 && loads < 300) {
    const amount = Math.min(2.24, pile.telemetry.remainingKg);
    assert(pile.scoop(0, 0, amount), `The remaining deposit supports a ${amount.toFixed(3)} kg load`);
    pile.update(1 / 60);
    loads++;
  }
  assert(loads < 300 && pile.telemetry.remainingKg < 1e-5, 'The source depletes fully, including its final partial scoop');
  assert(pile.telemetry.surfaceKg < .04, 'The visible source also depletes');
  assert.equal(pile.collisionFootprint, null, 'No invisible sand obstacle remains after depletion');
  console.log(JSON.stringify({ passed: true, initialKg: 600, remainingKg: pile.telemetry.surfaceKg, firstPitM, steepestSlope: steepest }));
} finally { await vite.close(); }
