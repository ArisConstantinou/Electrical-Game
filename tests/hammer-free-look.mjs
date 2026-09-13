import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const report = [];
try {
  const { PlayerController } = await server.ssrLoadModule('/src/player/PlayerController.ts');
  const { HammerWorkStance } = await server.ssrLoadModule('/src/player/HammerWorkStance.ts');
  const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-11, `${label}: ${actual} != ${expected}`);
  for (const tilt of [-45, 15, 45]) for (const initialYaw of [-.65, 0, .65]) {
    const keys = new Set();
    const input = { pressed: key => keys.has(key), mobileMove: { x: 0, y: 0 }, mobileLook: { x: 0, y: 0 } };
    const camera = new THREE.PerspectiveCamera(72, 16 / 9, .025, 60); camera.rotation.order = 'YXZ';
    const player = new PlayerController(camera, input), stance = new HammerWorkStance();
    camera.position.set(0, 1.65, -1.4); player.yaw = initialYaw; player.pitch = -.3;
    camera.rotation.set(player.pitch, player.yaw, 0);
    player.wallWorkEnabled = true; player.wallWorkDistance = .65;
    const frame = (tool = 'hammer', enabled = true) => {
      stance.restore(camera);
      player.wallWorkEnabled=tool==='hammer'&&enabled;
      const yaw = player.yaw, pitch = player.pitch;
      player.update(1 / 60);
      near(player.yaw, yaw, 'Wall standoff must not rewrite yaw'); near(player.pitch, pitch, 'Wall standoff must not rewrite pitch');
      camera.rotation.set(player.pitch, player.yaw, 0);
      const orientation = camera.quaternion.clone(), position = camera.position.clone();
      stance.update(camera, 1 / 60, 0, enabled, tilt, tool);
      near(1 - Math.abs(camera.quaternion.dot(orientation)), 0, 'Stance must never rotate the view');
      near(camera.position.distanceTo(position), 0, 'Stance must never move the view');
    };
    // Mouse input while the wall distance and presentation are still settling.
    keys.add('KeyW'); for (let i = 0; i < 5; i++) frame(); keys.clear();
    for (const [dx, dy] of [[1, 0], [37, -11], [-37, 11], [-1, 0]]) {
      const yaw = player.yaw, pitch = player.pitch;
      player.look(dx, dy);
      near(player.yaw, yaw - dx * .0023, 'Mouse delta must apply without a recenter offset');
      near(player.pitch, pitch - dy * .0023, 'Mouse pitch must remain direct');
      const requestedYaw = player.yaw, requestedPitch = player.pitch;
      for (let i = 0; i < 90; i++) frame();
      near(player.yaw, requestedYaw, 'Idle frames must retain the last mouse yaw');
      near(player.pitch, requestedPitch, 'Idle frames must retain the last mouse pitch');
    }
    const settledPosition = camera.position.clone();
    player.look(90, 15);
    for (let i = 0; i < 90; i++) { player.wallWorkDistance = .46 + Math.abs(Math.cos(player.yaw + i * .01)) * .45; frame(); }
    near(camera.position.distanceTo(settledPosition), 0, 'Changing aim/tool reach must not move a stationary braced player');
    const yaw = player.yaw, pitch = player.pitch;
    player.lookMobileDrag(20, -8); const mobileYaw = player.yaw, mobilePitch = player.pitch;
    for (let i = 0; i < 90; i++) frame();
    near(player.yaw, mobileYaw, 'Idle frames must retain the last touch yaw'); near(player.pitch, mobilePitch, 'Idle frames must retain the last touch pitch');
    player.lookMobileDrag(-20, 8); near(player.yaw, yaw, 'Touch reversal'); near(player.pitch, pitch, 'Touch pitch reversal');
    for (let i = 0; i < 30; i++) frame('spray');
    for (let i = 0; i < 30; i++) frame('hammer', false);
    keys.add('KeyS'); frame(); keys.clear();
    assert(!player.workPosition.locked, 'Backward intent must still release bracing');
    for (let i = 0; i < 30; i++) frame();
    near(player.yaw, yaw, 'Tool/stance transitions must not turn the view'); near(player.pitch, pitch, 'Tool/stance transitions must not pitch the view');
    report.push({ tilt, initialYaw, retainedYaw: player.yaw, retainedPitch: player.pitch });
  }
  console.log(JSON.stringify({ passed: true, cases: report.length, checks: ['mouse delta and reversal', 'touch drag and reversal', 'idle after look', 'standoff settling', 'tool change', 'backward release', 'no stance camera rotation'] }, null, 2));
} finally { await server.close(); }
