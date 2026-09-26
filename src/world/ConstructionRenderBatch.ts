import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { StaticConstructionTransforms } from './StaticConstructionTransforms';

/** Rendering copies of static frame elements; the authored meshes, metric UVs
 * and collision references remain intact and return for all editor workflows. */
export class ConstructionRenderBatch {
  private readonly sources = new Map<THREE.Mesh, boolean>();
  private readonly batches: THREE.Mesh[] = [];
  private editing = false;
  private readonly transforms = new StaticConstructionTransforms();

  build(root: THREE.Object3D): void {
    this.clear();
    this.editing = false;
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const buckets = new Map<string, THREE.Mesh[]>();
    const materialKeys=new Map<THREE.Material,string>();
    const materialMeta:THREE.JSONMeta={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}};
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) ||
          !(object.material instanceof THREE.MeshStandardMaterial) ||
          object.material.userData.referenceLaserReceiver ||
          !(object.userData.constructionRenderBatch || object.material.userData.constructionTileMeters) ||
          object instanceof THREE.InstancedMesh && !object.userData.constructionInstancesBaked) return;
      // Mortar backings change when a wall is chased or broken. They must stay
      // with the demolition system, even if they share the concrete texture.
      for(let node:THREE.Object3D|null=object;node&&node!==root;node=node.parent)
        if(node.userData.levelEditorKind==='brick-wall'||/mortar backing/i.test(node.name))return;
      let owner:THREE.Object3D=object;
      while(owner.parent&&owner.parent!==root)owner=owner.parent;
      const visibilityFloor=owner.userData.levelEditorFloor===5||owner.name.startsWith('B1 ')?5:
        owner.userData.levelEditorFloor===6||owner.name.startsWith('B2 ')?6:0;
      object.userData.constructionVisibilityFloor=visibilityFloor;
      const floor = Math.round(object.getWorldPosition(new THREE.Vector3()).y / 3.3);
      const attributes=Object.keys(object.geometry.attributes).sort().join(',');
      let materialKey=materialKeys.get(object.material);
      if(!materialKey){
        const {metadata,uuid,name,textures,images,userData,...renderState}=object.material.toJSON(materialMeta);
        materialKey=JSON.stringify(renderState)+object.material.customProgramCacheKey();
        materialKeys.set(object.material,materialKey);
      }
      const key = `${visibilityFloor}:${floor}:${materialKey}:${attributes}:${object.castShadow}:${object.receiveShadow}:${object.layers.mask}`;
      const meshes = buckets.get(key) ?? [];
      meshes.push(object); buckets.set(key, meshes);
    });
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const pieces = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
      const geometry = mergeGeometries(pieces);
      pieces.forEach(piece => piece.dispose());
      const source = meshes[0], batch = new THREE.Mesh(geometry, source.material);
      batch.name = `Shared static construction ${source.name}`;
      batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow;
      batch.layers.mask = source.layers.mask;
      batch.userData.editorIgnore = true;
      // Basement visibility is owned by the same floor as its authored source;
      // grouping may never make a hidden slab persist over an open stair void.
      batch.userData.levelEditorFloor=source.userData.constructionVisibilityFloor;
      batch.raycast = () => undefined;
      root.add(batch); this.batches.push(batch);
      for (const mesh of meshes) { this.sources.set(mesh, mesh.visible); mesh.visible = false; }
    }
    for (const mesh of this.sources.keys()) this.transforms.freeze(mesh);
    for (const batch of this.batches) this.transforms.freeze(batch);
  }

  disableForEditor(): void {
    if (this.editing) return;
    this.editing = true;
    this.transforms.restore();
    for (const [mesh, visible] of this.sources) mesh.visible = visible;
    for (const batch of this.batches) batch.visible = false;
  }

  clear(): void {
    this.disableForEditor();
    this.sources.clear();
    for (const batch of this.batches) { batch.removeFromParent(); batch.geometry.dispose(); }
    this.batches.length = 0;
  }
}
