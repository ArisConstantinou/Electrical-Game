import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.025, 60);
  readonly webgl: THREE.WebGLRenderer;

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(0xaab9bd);
    this.scene.fog = new THREE.Fog(0xaab9bd, 9, 24);
    this.scene.name = 'WIRE THE HOUSE scene';
    this.scene.userData.studioEntityId = 'scene:root';
    this.camera.name = 'First-person camera';
    this.camera.userData.studioEntityId = 'camera:first-person';
    this.camera.rotation.order = 'YXZ';
    this.webgl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(devicePixelRatio, GAME_CONFIG.renderer.maxPixelRatio));
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.05;
    this.webgl.domElement.id = 'game-canvas';
    this.webgl.domElement.setAttribute('aria-label', 'WIRE THE HOUSE first-person game');
    container.append(this.webgl.domElement);
    this.resize();
  }

  resize = (): void => {
    const parent = this.webgl.domElement.parentElement;
    const width = parent?.clientWidth ?? innerWidth;
    const height = parent?.clientHeight ?? innerHeight;
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(width, height, false);
  };

  render(): void { this.webgl.render(this.scene, this.camera); }
}
