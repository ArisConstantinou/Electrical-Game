import * as THREE from 'three';

export const REBAR_PLIER_LENGTH_M = .250;
export const TIE_WIRE_DIAMETER_M = .0016;
export const REBAR_TYING_ROLL = 2.4;
const forged = new THREE.MeshStandardMaterial({color:0x252a2b,metalness:.65,roughness:.62});
const cuttingSteel = new THREE.MeshStandardMaterial({color:0xaeb5b6,metalness:.88,roughness:.27});
const coating = new THREE.MeshStandardMaterial({color:0xbc1724,roughness:.47});
const wireSteel = new THREE.MeshStandardMaterial({color:0x444a4b,metalness:.68,roughness:.64});
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

function profile(parent:THREE.Group,shape:THREE.Shape,z:number,depth:number,material:THREE.Material,name:string,bevel=.0005):void {
  const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:10});
  geometry.translate(0,0,z);
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;parent.add(mesh);
}

/** Two complete forged halves: each handle drives the opposite end-cutting jaw.
 * Reference: KNIPEX 99 11 250 and the user's retained product photographs.
 * Metres, +Y towards the cutting edge, Z along the rivet axis. */
export function buildRebarPliers():THREE.Group {
  const group=new THREE.Group();group.name='250 mm concreters end-cutting nippers';
  for(const side of [-1,1]) {
    const half=new THREE.Group();half.name=side<0?'fixed-jaw':'rebar-plier-moving-jaw';group.add(half);
    const shape=new THREE.Shape();
    shape.moveTo(-.016,-.214);shape.lineTo(-.009,-.076);shape.lineTo(-.008,-.030);
    shape.quadraticCurveTo(-.006,-.018,.006,-.011);
    shape.quadraticCurveTo(.023,-.007,.023,.012);
    shape.quadraticCurveTo(.023,.026,.012,.033);
    shape.quadraticCurveTo(.007,.035,0,.034);shape.lineTo(0,.027);
    shape.quadraticCurveTo(.010,.026,.012,.018);shape.quadraticCurveTo(.015,.008,.006,.006);
    shape.lineTo(-.004,.006);shape.quadraticCurveTo(-.013,0,-.014,-.020);
    shape.lineTo(-.022,-.076);shape.lineTo(-.026,-.207);
    shape.quadraticCurveTo(-.025,-.214,-.021,-.214);shape.closePath();
    profile(half,shape,side<0?-.008:0,.007,forged,'Forged continuous handle and opposed jaw');
    const grip=new THREE.Shape();grip.moveTo(-.008,-.081);grip.lineTo(-.014,-.207);
    grip.quadraticCurveTo(-.014,-.214,-.020,-.214);grip.quadraticCurveTo(-.027,-.214,-.027,-.207);
    grip.lineTo(-.022,-.081);grip.quadraticCurveTo(-.014,-.078,-.008,-.081);grip.closePath();
    profile(half,grip,-.010,.020,coating,'Red dipped rounded handle',.001);
    const edge=new THREE.Shape();edge.moveTo(0,.027);edge.lineTo(0,.034);
    edge.quadraticCurveTo(.009,.035,.014,.030);edge.lineTo(.011,.024);
    edge.quadraticCurveTo(.007,.027,0,.027);edge.closePath();
    profile(half,edge,-.0085,.0165,cuttingSteel,'Polished bevel and meeting end-cutting edge',.00025);
    // Mirror the geometry, not a negative object scale (normal/winding safety).
    if(side>0)half.traverse(object=>{if(object instanceof THREE.Mesh){
      const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone(),positions=geometry.getAttribute('position');
      for(let i=0;i<positions.count;i+=3) {
        const a=[positions.getX(i),positions.getY(i),positions.getZ(i)];
        positions.setXYZ(i,-positions.getX(i+2),positions.getY(i+2),positions.getZ(i+2));
        positions.setXYZ(i+1,-positions.getX(i+1),positions.getY(i+1),positions.getZ(i+1));
        positions.setXYZ(i+2,-a[0],a[1],a[2]);
      }
      geometry.computeVertexNormals();object.geometry.dispose();object.geometry=geometry;
    }});
  }
  const pivot=new THREE.Mesh(new THREE.CylinderGeometry(.0068,.0068,.018,24),forged);
  pivot.name='Round flush pivot rivet';pivot.rotation.x=Math.PI/2;group.add(pivot);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.0049,.0049,.0006,24),cuttingSteel);
  cap.rotation.x=Math.PI/2;cap.position.z=.0095;cap.name='Rivet machined face';group.add(cap);
  const size=new THREE.Box3().setFromObject(group).getSize(V()),factor=REBAR_PLIER_LENGTH_M/size.y,widthFactor=.047/size.x;
  group.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.scale(/rivet/i.test(object.name)?1:widthFactor,factor,/rivet/i.test(object.name)?1:.023/size.z);});
  group.userData={lengthMm:250,gripPoint:[0,-.139*factor,0],tipPoint:[0,.0305*factor,0],gripSection:[.025*widthFactor,.0115],closedGripWidth:.025*widthFactor,jawAxis:[0,0,1],twistAxis:[0,1,0]};
  return group;
}

export function setRebarPliersClosed(group:THREE.Group,closed:number):void {
  const angle=(1-THREE.MathUtils.clamp(closed,0,1))*.085;
  group.getObjectByName('fixed-jaw')!.rotation.z=-angle;
  group.getObjectByName('rebar-plier-moving-jaw')!.rotation.z=angle;
  group.userData.closed=closed;
  group.userData.gripSection=[group.userData.closedGripWidth+Math.abs(group.userData.gripPoint[1]*Math.sin(angle)),.0115];
}

function tube(points:THREE.Vector3[],name:string):THREE.Mesh {
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),48,TIE_WIRE_DIAMETER_M/2,6,false),wireSteel);
  mesh.name=name;return mesh;
}

/** One continuous loose hairpin, with two flexible free ends. */
export function buildHeldRebar():THREE.Group {
  const group=new THREE.Group();group.name='1.6 mm black annealed tying wire';
  const points=[V(-.022,-.090,.003),V(-.040,-.018,0),V(-.047,.035,.002),V(-.032,.069,.002),V(0,.075,0),V(.035,.061,.002),V(.046,.028,.003),V(.026,-.025,.002),V(.018,-.104,.004)];
  group.add(tube(points,'Continuous folded tying wire and two free tails'));
  group.userData={gripPoint:[-.037,-.01,0],wireDiameterMm:1.6};return group;
}

interface WirePath {mesh:THREE.Mesh;open:THREE.Vector3[];closed:THREE.Vector3[];centres:THREE.Vector3[];phase?:number}
interface TieRig {paths:WirePath[];twistPaths:WirePath[];twist:THREE.Group;twistStart:THREE.Vector3;twistEnd:THREE.Vector3;last:number;facing:THREE.Vector3;tangent:THREE.Vector3;normal:THREE.Vector3;binormal:THREE.Vector3}
const rigs=new WeakMap<THREE.Group,TieRig>();
const pathSamples=48,radialSamples=6;

/** Deform centreline only. Wire radius, hole endpoints and root transform stay
 * invariant; position/normal buffers are reused throughout the animation. */
function deformPath(path:WirePath,t:number,rig:TieRig):void {
  const {centres,open,closed}=path;
  for(let i=0;i<centres.length;i++)centres[i].lerpVectors(open[i],closed[i],t);
  writeTube(path,rig);
}

function writeTube({centres,mesh}:WirePath,rig:TieRig):void {
  const positions=mesh.geometry.getAttribute('position'),normals=mesh.geometry.getAttribute('normal');
  for(let i=0;i<centres.length;i++) {
    rig.tangent.subVectors(centres[Math.min(i+1,pathSamples)],centres[Math.max(0,i-1)]).normalize();
    rig.facing.set(0,1,0);if(Math.abs(rig.tangent.y)>.95)rig.facing.set(0,0,1);
    rig.normal.crossVectors(rig.tangent,rig.facing).normalize();rig.binormal.crossVectors(rig.tangent,rig.normal).normalize();
    for(let j=0;j<=radialSamples;j++) {
      const a=j/radialSamples*Math.PI*2,c=Math.cos(a),s=Math.sin(a),index=i*(radialSamples+1)+j;
      const nx=rig.normal.x*c+rig.binormal.x*s,ny=rig.normal.y*c+rig.binormal.y*s,nz=rig.normal.z*c+rig.binormal.z*s;
      positions.setXYZ(index,centres[i].x+nx*.0008,centres[i].y+ny*.0008,centres[i].z+nz*.0008);normals.setXYZ(index,nx,ny,nz);
    }
  }
  positions.needsUpdate=true;normals.needsUpdate=true;mesh.geometry.computeBoundingSphere();
}

export function buildRebarHug(left:THREE.Vector3,right:THREE.Vector3,frontZ:number,pipeCentreX=(left.x+right.x)/2,closedFrontZ?:number):THREE.Group {
  const middle=left.clone().add(right).multiplyScalar(.5),group=new THREE.Group();group.position.copy(middle);group.name='Wall anchored 1.6 mm tying wire';
  const cx=pipeCentreX-middle.x,openZ=frontZ-middle.z+.025,closedZ=closedFrontZ===undefined?.0208:closedFrontZ-middle.z;
  const twist=new THREE.Group();twist.name='tie-wire-twist';twist.rotation.z=REBAR_TYING_ROLL;group.add(twist);
  const paths:WirePath[]=[],twistPaths:WirePath[]=[];
  for(const side of [-1,1]) {
    const anchor=(side<0?left:right).clone().sub(middle);
    const tailBase=V(side*.0008,0,0).applyEuler(twist.rotation);
    const openCurve=new THREE.CatmullRomCurve3([anchor,V(cx+side*.037,anchor.y*.6,openZ*.65),V(cx+side*.021,anchor.y*.2,openZ),V(cx+tailBase.x,tailBase.y,openZ)]);
    const closedCurve=new THREE.CatmullRomCurve3([anchor,V(cx+side*.023,anchor.y*.55,closedZ-.0178),V(cx+side*.0117,anchor.y*.12,closedZ-.0098),V(cx+side*.0075,0,closedZ-.0026),V(cx+tailBase.x,tailBase.y,closedZ)]);
    const mesh=tube(openCurve.points,side<0?'Left anchored wire to twist':'Right anchored wire to twist');group.add(mesh);
    const open=openCurve.getPoints(pathSamples),closed=closedCurve.getPoints(pathSamples);
    paths.push({mesh,open,closed,centres:open.map(p=>p.clone())});
    const points=Array.from({length:49},(_,i)=>{const t=i/48,a=(side<0?Math.PI:0)+t*Math.PI*5;return V(Math.cos(a)*.0008,-t*.022,Math.sin(a)*.0008);});
    const helix=tube(points,'Connected double strand twisted wire');twist.add(helix);
    twistPaths.push({mesh:helix,open:[],closed:[],centres:points.map(p=>p.clone()),phase:side<0?Math.PI:0});
  }
  const rig:TieRig={paths,twistPaths,twist,twistStart:V(cx,0,openZ),twistEnd:V(cx,0,closedZ),last:-1,facing:V(),tangent:V(),normal:V(),binormal:V()};rigs.set(group,rig);
  group.userData={leftHole:left.toArray(),rightHole:right.toArray(),wireDiameterMm:1.6,tighteningProgress:0,toolContact:[cx,-.018,openZ]};
  setTieWireProgress(group,0);return group;
}

/** Wire-first preparation must follow the actual selected pipe entry once
 * installed, while retaining both independently drilled endpoint depths. */
export function setTieWireTarget(group:THREE.Group,pipeCentreX:number,frontZ:number):void {
  const rig=rigs.get(group);if(!rig)return;
  const cx=pipeCentreX-group.position.x,z=frontZ-group.position.z;
  if(Math.abs(cx-rig.twistEnd.x)<1e-9&&Math.abs(z-rig.twistEnd.z)<1e-9)return;
  rig.twistEnd.set(cx,0,z);
  rig.paths.forEach((path,i)=>{
    const side=i===0?-1:1,anchor=path.open[0],tailBase=V(side*.0008,0,0).applyEuler(rig.twist.rotation);
    const curve=new THREE.CatmullRomCurve3([anchor,V(cx+side*.023,anchor.y*.55,z-.0178),V(cx+side*.0117,anchor.y*.12,z-.0098),V(cx+side*.0075,0,z-.0026),V(cx+tailBase.x,tailBase.y,z)]);
    curve.getPoints(pathSamples).forEach((p,j)=>path.closed[j].copy(p));
  });
  const progress=group.userData.tighteningProgress;rig.last=-1;setTieWireProgress(group,progress);
}

export function setTieWireProgress(group:THREE.Group,progress:number):void {
  const rig=rigs.get(group);if(!rig)return;
  const p=THREE.MathUtils.clamp(progress,0,1);if(p===rig.last)return;rig.last=p;
  const t=THREE.MathUtils.smoothstep(p,0,.75);
  rig.paths.forEach(path=>deformPath(path,t,rig));
  rig.twist.position.lerpVectors(rig.twistStart,rig.twistEnd,t);
  // Twist grows from two parallel tails. Fixed bases and a constant wire radius
  // prevent a detached knot or a flattened wire when the pair is tightened.
  const turns=THREE.MathUtils.smoothstep(p,.20,.87)*Math.PI*5;
  for(const path of rig.twistPaths){
    for(let i=0;i<=pathSamples;i++){const t=i/pathSamples,a=path.phase!+t*turns;path.centres[i].set(Math.cos(a)*.0008,-t*.022,Math.sin(a)*.0008);}
    writeTube(path,rig);
  }
  rig.twist.visible=true;
  group.userData.tighteningProgress=p;group.userData.toolContact=V(0,-.018,0).applyEuler(rig.twist.rotation).add(rig.twist.position).toArray();
}
