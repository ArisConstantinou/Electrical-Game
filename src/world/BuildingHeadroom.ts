import * as THREE from 'three';

/** Physical source meshes are retained even when hidden by render batching.
 * Test their real undersides; ignore editor-hidden items and render copies. */
export class BuildingHeadroom {
  private readonly cache = new WeakMap<THREE.Mesh, {matrix: THREE.Matrix4; geometry: THREE.BufferGeometry; version: number; bounds: THREE.Box3}>();
  private readonly ray = new THREE.Raycaster();
  private readonly up = new THREE.Vector3(0,1,0);
  constructor(private readonly root: THREE.Object3D) { this.ray.layers.enableAll(); }

  ceilingHeight(x:number,z:number,feetY:number,radius=.20):number {
    let ceiling=Infinity;
    const candidates:THREE.Mesh[]=[];
    this.root.traverse(object=>{
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) ||
          !object.material.userData.constructionTileMeters) return;
      for(let node:THREE.Object3D|null=object;node;node=node.parent)
        if(node.userData.editorIgnore || node.userData.levelEditorHidden)return;
      object.updateWorldMatrix(true,false);
      const version=object.geometry.getAttribute('position').version;
      let saved=this.cache.get(object);
      if(!saved || saved.geometry!==object.geometry || saved.version!==version || !saved.matrix.equals(object.matrixWorld)){
        object.geometry.computeBoundingBox();
        const bounds=object.geometry.boundingBox!.clone();
        if(object instanceof THREE.InstancedMesh){object.computeBoundingBox();bounds.copy(object.boundingBox!);}
        bounds.applyMatrix4(object.matrixWorld);
        saved={matrix:object.matrixWorld.clone(),geometry:object.geometry,version,bounds};this.cache.set(object,saved);
      }
      const b=saved.bounds;
      if(b.max.y<=feetY+.25||b.min.y>feetY+5||x+radius<b.min.x||x-radius>b.max.x||z+radius<b.min.z||z-radius>b.max.z)return;
      candidates.push(object);
    });
    for(const [dx,dz] of [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]]){
      this.ray.set(new THREE.Vector3(x+dx,feetY+.25,z+dz),this.up);this.ray.far=5;
      const hit=this.ray.intersectObjects(candidates,false)[0];
      if(hit)ceiling=Math.min(ceiling,hit.point.y);
    }
    return ceiling;
  }
}
