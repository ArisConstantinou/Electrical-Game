import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';

export const addLighting = (scene: THREE.Scene): void => {
  const fill = new THREE.AmbientLight(0xe5e9ea, .34);
  fill.name = 'Construction site fill light';
  fill.userData.studioEntityId = 'lighting:ambient-fill';
  scene.add(fill);

  const hemisphere = new THREE.HemisphereLight(0xdce7f1, 0x827a69, 1.1);
  hemisphere.name = 'Open-site ambient light';
  hemisphere.userData.studioEntityId = 'lighting:hemisphere';
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff1dd, 2.35);
  sun.name = 'Cyprus afternoon sun';
  sun.userData.studioEntityId = 'lighting:sun';
  // Low daylight comes through the existing open frontage. No new architectural
  // openings are needed and the cool sky fill leaves the recess interiors legible.
  sun.position.set(-3.8, 3.8, 5.4);
  sun.target.position.set(0, 1.1, -2.4);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(GAME_CONFIG.renderer.shadowMapSize, GAME_CONFIG.renderer.shadowMapSize);
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5;
  sun.shadow.camera.bottom = -5;
  sun.shadow.camera.far = 18;
  sun.shadow.normalBias = .012;
  sun.shadow.bias = -.00012;
  sun.shadow.radius = 2;
  scene.add(sun);
};
