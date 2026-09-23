import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { siteMaterial } from './SiteMaterials';

/** Continuous cast underside filling the space between a wall head and slab. */
export function createConcreteSoffit(width: number, depth: number, undersideY: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Continuous cast concrete soffit';
  group.userData.studioEntityId = 'world:concrete-soffit';
  const concrete = siteMaterial('concrete', 0xd4cec4, width / 2, depth / 2);
  concrete.normalScale.set(.34, .34);
  const panel = new THREE.Mesh(new RoundedBoxGeometry(width, .18, depth, 2, .006), concrete);
  panel.name = 'Board-formed concrete underside';
  panel.position.y = undersideY + .09;
  panel.castShadow = panel.receiveShadow = true;
  group.add(panel);
  return group;
}
