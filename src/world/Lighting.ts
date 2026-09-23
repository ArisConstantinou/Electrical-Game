import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';

export const addLighting = (scene: THREE.Scene): THREE.DirectionalLight => {
  const fill = new THREE.AmbientLight(0xe5e9ea, .58);
  fill.name = 'Construction site fill light';
  fill.userData.studioEntityId = 'lighting:ambient-fill';
  scene.add(fill);

  const hemisphere = new THREE.HemisphereLight(0xdce7f1, 0x827a69, 1.28);
  hemisphere.name = 'Open-site ambient light';
  hemisphere.userData.studioEntityId = 'lighting:hemisphere';
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff1dd, 2.05);
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
  sun.shadow.camera.layers.enable(1);
  scene.add(sun);

  // Daylight bouncing off the open front illuminates the back masonry without
  // inventing a light source or an exterior image behind a fake opening.
  const bounce = new THREE.DirectionalLight(0xfff3df, 1.15);
  bounce.name = 'Front opening reflected daylight';
  bounce.userData.studioEntityId = 'lighting:front-bounce';
  bounce.position.set(0, 2.7, -1.8);
  bounce.target.position.set(0, 1.35, 3.5);
  scene.add(bounce.target, bounce);

  const slabBounce = new THREE.DirectionalLight(0xf5e7d1, .58);
  slabBounce.name = 'Floor-reflected slab fill';
  slabBounce.userData.studioEntityId = 'lighting:slab-bounce';
  slabBounce.position.set(0, .4, 0);
  slabBounce.target.position.set(0, 3.4, 0);
  scene.add(slabBounce.target, slabBounce);
  return sun;
};
