import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {build} from 'esbuild';
import * as THREE from 'three';
const compiled=await build({stdin:{contents:"export {splitDebrisGeometry} from './src/systems/splitDebrisGeometry'; export {MasonryVolume} from './src/world/MasonryVolume';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {splitDebrisGeometry,MasonryVolume}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const report=[];
const soup=g=>g.index?g.toNonIndexed():g;
function volume(g){const a=g.getAttribute('position'),x=new THREE.Vector3(),y=new THREE.Vector3(),z=new THREE.Vector3();let v=0;for(let i=0;i<a.count;i+=3){x.fromBufferAttribute(a,i);y.fromBufferAttribute(a,i+1);z.fromBufferAttribute(a,i+2);v+=x.dot(y.cross(z))/6;}return v;}
function closed(g){
 const a=g.getAttribute('position'),eps=1e-7,points=new Map(),edges=new Map(),key=p=>p.toArray().map(v=>Math.round(v/eps)).join(',');
 const add=(a,b,n=1)=>{if(a===b)return;const k=a<b?a+':'+b:b+':'+a;edges.set(k,(edges.get(k)??0)+(a<b?n:-n));};
 for(let i=0;i<a.count;i+=3){const p=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(a,i+j));for(let j=0;j<3;j++){points.set(key(p[j]),p[j]);add(key(p[j]),key(p[(j+1)%3]));}}
 const residual=[...edges].filter(([,n])=>n).map(([k,n])=>({keys:k.split(':'),n}));if(!residual.length)return;
 const ends=new Map();for(const {keys}of residual)for(const k of keys)ends.set(k,points.get(k));edges.clear();
 for(const {keys,n}of residual){const p=points.get(keys[0]),q=points.get(keys[1]),d=q.clone().sub(p),length=d.lengthSq(),parts=[];for(const [k,v]of ends){const t=v.clone().sub(p).dot(d)/length;if(t>=-1e-6&&t<=1+1e-6&&p.clone().addScaledVector(d,t).distanceTo(v)<eps*2)parts.push({k,t});}parts.sort((a,b)=>a.t-b.t);for(let i=1;i<parts.length;i++)add(parts[i-1].k,parts[i].k,n);}
 assert([...edges.values()].every(n=>n===0),'child shell and caps are closed with balanced oriented edges');
}
function recursive(name,initial,minimumVolume=0,rotate=true){
 let g=initial.clone(),generations=0;
 for(let generation=0;generation<8;generation++){
  if(Math.abs(volume(g))<=minimumVolume)break;
  const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(.173+generation*.017,-.247,.129));if(rotate)g.applyQuaternion(quaternion);g.computeBoundingBox();const center=g.boundingBox.getCenter(new THREE.Vector3());g.translate(-center.x,-center.y,-center.z);g.computeBoundingBox();
  const size=g.boundingBox.getSize(new THREE.Vector3()),axes=['x','y','z'].sort((a,b)=>size[b]-size[a]);let candidate=null;
  for(const axis of axes){for(const fraction of [.5,.43]){const coordinate=g.boundingBox.min[axis]+size[axis]*fraction,result=splitDebrisGeometry(g,axis,coordinate,{maxVertices:120000});if(result){candidate={axis,coordinate,result};break;}}if(candidate)break;}
  assert(candidate,name+' transformed child generation '+generation+' remains cuttable');
  const checked=check(name+'-recursive-'+generation,g,candidate.axis,candidate.coordinate);g=checked.pieces.sort((a,b)=>b.volume-a.volume)[0].geometry;generations++;
 }
 return {generations,remainingVolume:Math.abs(volume(g))};
}
function check(name,g,axis,coordinate,expected){
 const original=Array.from(g.getAttribute('position').array),start=performance.now(),split=splitDebrisGeometry(g,axis,coordinate,{maxVertices:120000});const splitMs=performance.now()-start;assert(split,`${name} must split`);
 assert.deepEqual(Array.from(g.getAttribute('position').array),original,'input geometry remains unchanged');
 if(expected!==undefined)assert(Math.abs(split.originalVolume-expected)<expected*1e-5,`${name} original volume`);
 const total=split.pieces.reduce((sum,p)=>sum+p.volume,0);assert(Math.abs(total-split.originalVolume)<split.originalVolume*2e-5,`${name} conserves volume`);
 g.computeBoundingBox();const cut=Math.fround(coordinate??(g.boundingBox.min[axis]+g.boundingBox.max[axis])*.5),bounds=g.boundingBox;
 for(const [side,piece]of split.pieces.entries()){
  assert(piece.volume>0);closed(piece.geometry);assert(Math.abs(volume(piece.geometry)-piece.volume)<piece.volume*1e-5,'returned volume matches geometry');
  const a=piece.geometry.getAttribute('position');let capArea=0;
  for(let i=0;i<a.count;i+=3){const tri=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(a,i+j));for(const p of tri){assert(bounds.clone().expandByScalar(1e-6).containsPoint(p),'no growth beyond source bounds');assert(side===0?p[axis]<=cut+1e-7:p[axis]>=cut-1e-7,'correct plane side');}
   if(tri.every(v=>Math.abs(v[axis]-cut)<1e-7)){const n=tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0]));assert(n[axis]*(side===0?1:-1)>=-1e-10,'cap faces outward');capArea+=n.length()*.5;}}
  assert(capArea>0,'cut plane has caps');
 }
 // First visible intersection from all six sides preserves the source outline,
 // including recesses and through holes, without substituting bounding boxes.
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),source=new THREE.Mesh(g,material),pieces=split.pieces.map(p=>new THREE.Mesh(p.geometry,material));
 const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),ray=new THREE.Raycaster();let rays=0;
 for(const directionAxis of ['x','y','z'])for(const sign of [-1,1])for(let i=0;i<9;i++){
  const others=['x','y','z'].filter(a=>a!==directionAxis),origin=center.clone();origin[directionAxis]+=sign*(size[directionAxis]+.1);origin[others[0]]+=(i%3-1)*size[others[0]]*.37;origin[others[1]]+=(Math.floor(i/3)-1)*size[others[1]]*.37;
  const direction=new THREE.Vector3();direction[directionAxis]=-sign;ray.set(origin,direction);
  const before=ray.intersectObject(source,false)[0],after=ray.intersectObjects(pieces,false)[0];assert.equal(Boolean(after),Boolean(before),`${name} ray silhouette preserved`);if(before)assert(Math.abs(before.distance-after.distance)<1e-6,`${name} first surface preserved`);rays++;
 }
 report.push({name,axis,splitMs,triangles:g.getAttribute('position').count/3,childTriangles:split.pieces.map(p=>p.geometry.getAttribute('position').count/3),volume:split.originalVolume,rays,milliseconds:performance.now()-start});return split;
}
for(const axis of ['x','y','z'])check(`box-${axis}`,soup(new THREE.BoxGeometry(.12,.08,.06)),axis,undefined,.12*.08*.06);
const l=new THREE.Shape();l.moveTo(0,0);for(const p of [[.12,0],[.12,.04],[.04,.04],[.04,.12],[0,.12]])l.lineTo(...p);l.closePath();const lg=new THREE.ExtrudeGeometry(l,{depth:.06,bevelEnabled:false,steps:1});
check('concave-L',lg,'z',.03,(.12*.04+.04*.08)*.06);check('L-coplanar-elbow',lg,'y',.04);
const ring=new THREE.Shape();ring.moveTo(-.06,-.06);for(const p of [[.06,-.06],[.06,.06],[-.06,.06]])ring.lineTo(...p);ring.closePath();const hole=new THREE.Path();hole.moveTo(-.025,-.025);for(const p of [[-.025,.025],[.025,.025],[.025,-.025]])hole.lineTo(...p);hole.closePath();ring.holes.push(hole);
check('through-hole',new THREE.ExtrudeGeometry(ring,{depth:.08,bevelEnabled:false,steps:1}),'z',.04,(.12**2-.05**2)*.08);
recursive('L',lg);
const box=soup(new THREE.BoxGeometry(.1,.1,.1));assert.equal(splitDebrisGeometry(box,'x',.2),null);assert.equal(splitDebrisGeometry(box,'x',NaN),null);const open=box.clone();open.setAttribute('position',new THREE.Float32BufferAttribute(Array.from(box.getAttribute('position').array).slice(9),3));assert.equal(splitDebrisGeometry(open,'x'),null,'open shell rejected');
const masonry=new MasonryVolume({width:.32,height:.30,depth:.14,frontZ:0,cellSize:.008,seed:9217,renderThickness:0,material:'hollow-clay'});let count=0;
for(let i=0;i<8&&count<4;i++){
 const hit=masonry.raycast({x:(i%3-1)*.03,y:.13,z:.06},{x:0,y:0,z:-1},.25);if(!hit)continue;const impact=masonry.impact({point:hit.point,direction:{x:0,y:-.2,z:-1},chisel:'flat',widthM:.04,energyJ:24});
 for(const fragment of impact.fragments.filter(f=>f.positions?.length>90).sort((a,b)=>b.volume-a.volume).slice(0,2)){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(fragment.positions,3));g.computeBoundingBox();const size=g.boundingBox.getSize(new THREE.Vector3()),axis=['x','y','z'].sort((a,b)=>size[b]-size[a])[0];
  if(g.getAttribute('position').count>12000){const start=performance.now();assert.equal(splitDebrisGeometry(g,axis),null,'large mesh returns immediately to gameplay knock fallback');assert(performance.now()-start<5,'large mesh performs no clipping work');}
  check(`actual-masonry-${count}`,g,axis,undefined,fragment.volume);if(count<2)recursive('actual-'+count,g);count++;if(count>=4)break;
 }
}
// Captured from a native 1891-triangle child hit 93 times after five successful
// splits. Recapture was unnecessary: preserve the exact Float32 failure input.
const fixtureBytes=gunzipSync(readFileSync(new URL('./fixtures/lodged-debris-1891.f32.gz',import.meta.url)));
const fixturePositions=new Float32Array(fixtureBytes.buffer.slice(fixtureBytes.byteOffset,fixtureBytes.byteOffset+fixtureBytes.byteLength));
const fixtureGeometry=new THREE.BufferGeometry();fixtureGeometry.setAttribute('position',new THREE.BufferAttribute(fixturePositions,3));
const recovered=recursive('captured-lodged-child',fixtureGeometry,.000008,false);
assert(recovered.generations>=2&&recovered.remainingVolume<=.000008,'real lodged child can be rebroken below the gameplay fragment cutoff');
assert(count>=3,'tested multiple actual MasonryVolume fragments');console.log(JSON.stringify({checks:report,unsafeInputs:'open mesh, NaN and outside plane rejected'},null,2));
