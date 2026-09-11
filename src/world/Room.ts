import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { INSTALLATION_POINTS } from '../data/installationRules';
import { BrickWall } from './BrickWall';
import { addLighting } from './Lighting';

const constructionMaterial = (color: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.98, metalness: 0 });

export class Room extends THREE.Group {
  readonly brickWall: BrickWall;

  constructor(scene: THREE.Scene) {
    super();
    this.name = 'Living room first-fix site';
    this.userData.studioEntityId = 'world:living-room';
    this.brickWall = new BrickWall(INSTALLATION_POINTS);
    this.add(this.brickWall);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(GAME_CONFIG.room.width, 0.12, GAME_CONFIG.room.depth), constructionMaterial(0x77736a));
    floor.position.y = -0.06;
    floor.name = 'Rough unfinished concrete floor';
    floor.userData.studioEntityId = 'world:floor';
    floor.receiveShadow = true;
    this.add(floor);

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(GAME_CONFIG.room.width, 0.16, GAME_CONFIG.room.depth), constructionMaterial(0x8a8983));
    ceiling.position.y = GAME_CONFIG.room.height + 0.08;
    ceiling.name = 'Concrete slab ceiling';
    ceiling.userData.studioEntityId = 'world:ceiling';
    ceiling.receiveShadow = true;
    this.add(ceiling);

    const sideMaterial = constructionMaterial(0x8c8880);
    const sideGeometry = new THREE.BoxGeometry(0.22, GAME_CONFIG.room.height, GAME_CONFIG.room.depth);
    for (const [name, x] of [['Left concrete wall', -GAME_CONFIG.room.width / 2 - 0.11], ['Right concrete wall', GAME_CONFIG.room.width / 2 + 0.11]] as const) {
      const side = new THREE.Mesh(sideGeometry, sideMaterial);
      side.position.set(x, GAME_CONFIG.room.height / 2, 0);
      side.name = name;
      side.userData.studioEntityId = `world:${name.toLowerCase().replaceAll(' ', '-')}`;
      side.receiveShadow = true;
      this.add(side);
    }

    const columnMaterial = constructionMaterial(0x817d75);
    for (const x of [-2.72, 2.72]) {
      const column = new THREE.Mesh(new THREE.BoxGeometry(0.36, GAME_CONFIG.room.height, 0.38), columnMaterial);
      column.position.set(x, GAME_CONFIG.room.height / 2, -2.37);
      column.name = 'Structural concrete column';
      column.userData.studioEntityId = `world:column:${x}`;
      column.castShadow = true;
      column.receiveShadow = true;
      this.add(column);
    }

    const rubbleMaterial = constructionMaterial(0x9c6c50);
    for (let index = 0; index < 26; index += 1) {
      const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.025 + (index % 4) * 0.007, 0), rubbleMaterial);
      rubble.position.set(-2.5 + ((index * 1.71) % 5), 0.025, -2.05 + (index % 5) * 0.11);
      rubble.rotation.set(index, index * 0.7, index * 0.2);
      rubble.name = 'Brick rubble';
      this.add(rubble);
    }
    addLighting(scene);
  }
}
