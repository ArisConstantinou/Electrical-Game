import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const materials = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();
const textures = new Map<string, THREE.Texture>();
// Bake only metric construction batches, retaining one draw and the same
// editable object. This also works in WebGPU, where onBeforeCompile is ignored.
function expandConstructionInstances(mesh:THREE.InstancedMesh):void {
  if(mesh.userData.constructionInstancesBaked)return;
  const pieces:THREE.BufferGeometry[]=[];
  const matrix=new THREE.Matrix4(),tint=new THREE.Color();
  for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,matrix);
    if(Math.abs(matrix.determinant())<1e-10)continue;
    const geometry=mesh.geometry.clone();geometry.applyMatrix4(matrix);
    if(mesh.instanceColor){
      mesh.getColorAt(i,tint);
      const count=geometry.getAttribute('position').count;
      const color=new Float32Array(count*3),old=geometry.getAttribute('color');
      for(let v=0;v<count;v++){
        color[v*3]=tint.r*(old?.getX(v)??1);
        color[v*3+1]=tint.g*(old?.getY(v)??1);
        color[v*3+2]=tint.b*(old?.getZ(v)??1);
      }
      geometry.setAttribute('color',new THREE.BufferAttribute(color,3));
    }
    pieces.push(geometry);
  }
  if(!pieces.length)return;
  mesh.geometry=mergeGeometries(pieces);
  pieces.forEach(piece=>piece.dispose());
  if(mesh.instanceColor){
    const material=(mesh.material as THREE.MeshStandardMaterial).clone();
    material.vertexColors=true;mesh.material=material;
    mesh.setColorAt(0,new THREE.Color(1,1,1));mesh.instanceColor.needsUpdate=true;
  }
  mesh.count=1;mesh.setMatrixAt(0,new THREE.Matrix4());mesh.instanceMatrix.needsUpdate=true;
  mesh.computeBoundingBox();mesh.computeBoundingSphere();
  mesh.userData.constructionInstancesBaked=true;
  mesh.userData.ownsConstructionUV=true;
}

function metricMaterial(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const cached = materials.get(source);
  if (cached) return cached;
  const material = source.clone();
  for (const slot of ['map', 'normalMap', 'bumpMap'] as const) {
    const texture = source[slot];
    if (!texture) continue;
    const key = texture.name || texture.uuid;
    let normalized = textures.get(key);
    if (!normalized) {
      normalized = texture.clone();
      normalized.repeat.set(1, 1);
      normalized.offset.set(0, 0);
      normalized.rotation = 0;
      normalized.wrapS = normalized.wrapT = THREE.RepeatWrapping;
      normalized.needsUpdate = true;
      textures.set(key, normalized);
    }
    material[slot] = normalized;
  }
  materials.set(source, material);
  materials.set(material, material);
  return material;
}

/** Metric face projection: one physical tile size, independent of slab aspect
 * ratio. Runs on construction/edit, never during an ordinary gameplay frame.
 * Geometry is owned by the mesh so a shared box cannot change another asset. */
export function mapBuildingSurfaces(root: THREE.Object3D): number {
  root.updateWorldMatrix(true, true);
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();
  const normal=new THREE.Vector3(), edge=new THREE.Vector3(), u=new THREE.Vector3(), v=new THREE.Vector3();
  let count = 0;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    let source = object.material as THREE.MeshStandardMaterial;
    const tile = source.userData.constructionTileMeters as number | undefined;
    if (!tile || !object.geometry.getAttribute('normal') || !object.geometry.getAttribute('uv')) return;
    const transform = object.matrixWorld.clone();
    if (object instanceof THREE.InstancedMesh) {
      expandConstructionInstances(object);
      source=object.material as THREE.MeshStandardMaterial;
    }
    const signatureOf = () => `${object.geometry.uuid}:${object.geometry.getAttribute('position').version}:${tile}:${transform.elements.join(',')}`;
    const signature = signatureOf();
    if (object.userData.constructionUVTransform === signature) return;
    if (!object.userData.ownsConstructionUV) {
      object.geometry = object.geometry.clone();
      object.userData.ownsConstructionUV = true;
    }
    if(object.geometry.index){
      const indexed=object.geometry;object.geometry=indexed.toNonIndexed();indexed.dispose();
    }
    const geometry = object.geometry;
    const vertices = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    // Project onto each actual triangle plane. Sloped stair soffits and
    // rotated slabs keep the same metric density as horizontal floors.
    for (let i=0;i<vertices.count;i+=3){
      a.fromBufferAttribute(vertices,i).applyMatrix4(transform);
      b.fromBufferAttribute(vertices,i+1).applyMatrix4(transform);
      c.fromBufferAttribute(vertices,i+2).applyMatrix4(transform);
      normal.subVectors(b,a).cross(edge.subVectors(c,a)).normalize();
      const x=Math.abs(normal.x),y=Math.abs(normal.y),z=Math.abs(normal.z);
      if(x>y && x>z)u.set(0,0,1);else u.set(1,0,0);
      u.addScaledVector(normal,-u.dot(normal)).normalize();
      v.crossVectors(normal,u);
      if((y>=x&&y>=z?v.z:v.y)<0)v.negate();
      uv.setXY(i,a.dot(u)/tile,a.dot(v)/tile);
      uv.setXY(i+1,b.dot(u)/tile,b.dot(v)/tile);
      uv.setXY(i+2,c.dot(u)/tile,c.dot(v)/tile);
    }
    uv.needsUpdate = true;
    object.material = metricMaterial(source);
    object.userData.constructionUVTransform = signatureOf();
    object.userData.constructionUVTileMeters = tile;
    count++;
  });
  return count;
}
