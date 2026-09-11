import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';

export const addLighting = (scene: THREE.Scene): void => {
  const fill = new THREE.AmbientLight(0xffead5, 1.25);
  fill.name = 'Construction site fill light';
  fill.userData.studioEntityId = 'lighting:ambient-fill';
  scene.add(fill);

  const hemisphere = new THREE.HemisphereLight(0xcde2ed, 0x7e5b43, 1.65);
  hemisphere.name = 'Open-site ambient light';
  hemisphere.userData.studioEntityId = 'lighting:hemisphere';
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffe4bc, 3.1);
  sun.name = 'Cyprus afternoon sun';
  sun.userData.studioEntityId = 'lighting:sun';
  sun.position.set(-3.5, 6.5, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(GAME_CONFIG.renderer.shadowMapSize, GAME_CONFIG.renderer.shadowMapSize);
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5;
  sun.shadow.camera.bottom = -5;
  sun.shadow.camera.far = 18;
  scene.add(sun);
};
