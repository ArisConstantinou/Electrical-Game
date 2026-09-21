import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, texture as sampleTexture, uv, vec3 } from 'three/tsl';

// Metres, Y up. The wheelbarrow wheel is +Z; the mixer mouth faces -Z.
// Photo-led, editable assemblies: pressed shells, bent tubes and lathed parts.
type V = readonly [number, number, number];
const paint = (color:number,roughness=.38,metalness=.32) => new THREE.MeshStandardMaterial({color,roughness,metalness});
const paintedSteelScan = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/site-materials/rusty_metal_03-diff-1k.jpg`);
paintedSteelScan.colorSpace = THREE.SRGBColorSpace;
paintedSteelScan.wrapS = paintedSteelScan.wrapT = THREE.RepeatWrapping;
paintedSteelScan.anisotropy = 4;
function wornPowderCoat(color:number, withVertexColor=false):MeshStandardNodeMaterial {
  const base = new THREE.Color(color);
  const material = new MeshStandardNodeMaterial({roughness:.76,metalness:.18});
  material.name = 'Powder-coated steel with photographed site wear';
  const photographedWear = mix(vec3(1), sampleTexture(paintedSteelScan, uv()).rgb, .60);
  const surface = vec3(base.r,base.g,base.b).mul(photographedWear);
  material.colorNode = withVertexColor ? surface.mul(attribute<'vec3'>('color','vec3')) : surface;
  return material;
}
function group(name:string):THREE.Group {
  const g=new THREE.Group();g.name=name;g.userData.studioEntityId=`equipment:${name}`;return g;
}
function mesh(parent:THREE.Object3D,name:string,geometry:THREE.BufferGeometry,material:THREE.Material,at:V=[0,0,0]):THREE.Mesh {
  const m=new THREE.Mesh(geometry,material);m.name=name;m.position.set(...at);m.castShadow=true;m.receiveShadow=true;
  m.userData.studioEntityId=`equipment:${parent.name}:${name}`;parent.add(m);return m;
}
function bar(parent:THREE.Object3D,name:string,a:V,b:V,r:number,mat:THREE.Material,square=false):THREE.Mesh {
  const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),d=to.clone().sub(from);
  const m=mesh(parent,name,square?new THREE.BoxGeometry(r*2,d.length(),r*2):new THREE.CylinderGeometry(r,r,d.length(),12),mat);
  m.position.copy(from).add(to).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m;
}
function tube(parent:THREE.Object3D,name:string,points:V[],r:number,mat:THREE.Material,closed=false):THREE.Mesh {
  const path=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed,'centripetal');
  return mesh(parent,name,new THREE.TubeGeometry(path,Math.max(40,points.length*3),r,8,closed),mat);
}
function lathe(parent:THREE.Object3D,name:string,profile:number[][],mat:THREE.Material,at:V=[0,0,0],segments=64):THREE.Mesh {
  return mesh(parent,name,new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(p[0],p[1])),segments),mat,at);
}
function torus(parent:THREE.Object3D,name:string,r:number,t:number,mat:THREE.Material,at:V,axis:'x'|'y'|'z'='y'):THREE.Mesh {
  const m=mesh(parent,name,new THREE.TorusGeometry(r,t,10,64),mat,at);
  if(axis==='y')m.rotation.x=Math.PI/2;if(axis==='x')m.rotation.y=Math.PI/2;return m;
}
function copies(parent:THREE.Object3D,name:string,geo:THREE.BufferGeometry,mat:THREE.Material,transforms:THREE.Matrix4[]):void {
  const m=new THREE.InstancedMesh(geo,mat,transforms.length);m.name=name;m.userData.studioEntityId=`equipment:${parent.name}:${name}`;
  transforms.forEach((t,i)=>m.setMatrixAt(i,t));m.castShadow=true;m.receiveShadow=true;parent.add(m);
}
function wheel(parent:THREE.Object3D,name:string,r:number,width:number,at:V,tread:boolean):void {
  const g=group(name);g.position.set(...at);parent.add(g);g.rotation.z=Math.PI/2;
  const rubber=paint(0x202322,.86,0),rim=paint(0xaeb4b2,.3,.8),black=paint(0x353936,.5,.6);
  const profile=[[r*.55,-width*.38],[r*.71,-width*.52],[r*.88,-width*.48],[r*.98,-width*.30],[r,0],[r*.98,width*.30],[r*.88,width*.48],[r*.71,width*.52],[r*.55,width*.38],[r*.55,-width*.38]];
  lathe(g,`${name}-rubber-carcass`,profile,rubber);
  lathe(g,`${name}-pressed-rim`,[[.019,-width*.53],[r*.25,-width*.53],[r*.45,-width*.22],[r*.58,-width*.34],[r*.66,-width*.34],[r*.67,0],[r*.66,width*.34],[r*.58,width*.34],[r*.45,width*.22],[r*.25,width*.53],[.019,width*.53]],rim);
  for(const s of [-1,1]){
    torus(g,`${name}-sidewall-bead-${s}`,r*.76,.003,rubber,[0,s*width*.505,0]);
    torus(g,`${name}-rim-lip-${s}`,r*.60,.004,rim,[0,s*width*.34,0]);
    mesh(g,`${name}-axle-cap-${s}`,new THREE.CylinderGeometry(.027,.027,.01,6),black,[0,s*(width*.54),0]);
  }
  if(tread){const transforms:THREE.Matrix4[]=[];
    for(let i=0;i<42;i++)for(const s of [-1,1]){const angle=i/42*Math.PI*2;const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-angle,s*.40));transforms.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(angle)*r,s*width*.20,Math.cos(angle)*r),q,new THREE.Vector3(1,1,1)));}
    copies(g,`${name}-chevron-tread`,new THREE.BoxGeometry(.012,width*.48,.005),rubber,transforms);
  }
}

// Rounded rectangular cross section, narrower at the pouring/front end.
function trayPoint(angle:number,halfWidth:number,halfLength:number,y:number):THREE.Vector3 {
  const sin=Math.sin(angle),cos=Math.cos(angle),z=Math.sign(cos)*Math.pow(Math.abs(cos),.60)*halfLength;
  const x=Math.sign(sin)*Math.pow(Math.abs(sin),.60)*halfWidth*(1-.09*(halfLength?z/halfLength:0));
  return new THREE.Vector3(x,y+.05*z,z);
}
function trayShell():THREE.BufferGeometry {
  const sections=[[.006,.008,.407],[.195,.275,.407],[.226,.307,.427],[.272,.369,.51],[.345,.474,.676],[.363,.496,.696],[.367,.499,.703],[.360,.492,.71],[.350,.483,.700],[.335,.462,.681],[.261,.357,.513],[.215,.297,.439],[.185,.265,.425],[.006,.008,.425]];
  const p:number[]=[],uv:number[]=[],indices:number[]=[],n=80;
  sections.forEach(([w,l,h],j)=>{for(let i=0;i<=n;i++){const v=trayPoint(i/n*Math.PI*2,w,l,h);p.push(v.x,v.y,v.z);uv.push(i/n,j/(sections.length-1));}});
  for(let j=0;j<sections.length-1;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+n+1;indices.push(a,a+1,b,a+1,b+1,b);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
export interface WheelbarrowModel {group:THREE.Group; mortar:THREE.Mesh;}
export function setWheelbarrowFill(model:WheelbarrowModel,fraction:number):void {
  const f=THREE.MathUtils.clamp(fraction,0,1),geo=model.mortar.geometry,p=geo.getAttribute('position');model.mortar.visible=f>0;
  // Volume of a flaring tray grows faster than its height; conserve volume by
  // inverting the integral of its squared, linearly growing cross section.
  const bottomArea=.215*.297,aw=.125,al=.168;
  const volume=(h:number)=>bottomArea*h+(.215*al+.297*aw)*h*h/2+aw*al*h*h*h/3;
  let low=0,high=1;for(let i=0;i<18;i++){const mid=(low+high)/2;if(volume(mid)<f*volume(1))low=mid;else high=mid;}const h=(low+high)/2;
  let v=0;for(let ring=0;ring<=18;ring++)for(let i=0;i<=80;i++){
    const r=ring/18,a=i/80*Math.PI*2,point=trayPoint(a,(.215+.125*h)*r,(.297+.168*h)*r,.44+.248*h);
    const mound=(1-r*r)*(.021+.009*Math.sin(point.x*24+point.z*12)+.005*Math.cos(point.z*37));
    point.y+=mound*Math.min(1,f*8);p.setXYZ(v++,point.x,point.y,point.z);
  }
  p.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingSphere();
}
export function createWheelbarrow():WheelbarrowModel {
  const root=group('ready-mortar-wheelbarrow'),yellow=paint(0xe2b02e,.7,.18),frame=paint(0x252c29,.72,.25),rubber=paint(0x171b19,.9,0),silver=paint(0xa8afab,.48,.62);
  mesh(root,'pressed-yellow-tray',trayShell(),wornPowderCoat(0xe2b02e));
  const rim:V[]=Array.from({length:80},(_,i)=>trayPoint(i/80*Math.PI*2,.361,.493,.705).toArray() as [number,number,number]);
  tube(root,'rolled-yellow-safety-rim',rim,.007,yellow,true);
  for(const s of [-1,1]){
    tube(root,`continuous-handle-rail-${s}`,[[s*.20,.205,.62],[s*.235,.34,.40],[s*.245,.40,-.24],[s*.283,.53,-.57],[s*.302,.69,-.97]],.017,frame);
    bar(root,`rubber-hand-grip-${s}`,[s*.29,.625,-.81],[s*.309,.717,-1.01],.022,rubber);
    tube(root,`bent-support-leg-${s}`,[[s*.25,.41,-.26],[s*.28,.14,-.35],[s*.285,.023,-.25],[s*.275,.023,-.08],[s*.23,.40,.09]],.015,frame);
    bar(root,`under-tray-spreader-${s}`,[s*.218,.415,-.31],[s*.19,.415,.29],.02,frame,true);
    for(const z of [-.22,.20]){mesh(root,`tray-bolt-${s}-${z}`,new THREE.CylinderGeometry(.012,.012,.008,6),silver,[s*.17,.436,z]);}
    bar(root,`axle-bracket-${s}`,[s*.10,.202,.58],[s*.20,.202,.58],.027,frame,true);
  }
  bar(root,'rear-foot-cross-brace',[-.275,.14,-.30],[.275,.14,-.30],.010,frame);
  bar(root,'front-frame-cross-brace',[-.22,.34,.39],[.22,.34,.39],.013,frame);
  bar(root,'wheel-axle',[-.18,.202,.58],[.18,.202,.58],.012,silver);
  wheel(root,'single-pneumatic-wheel',.202,.105,[0,.202,.58],true);
  const material=paint(0x858171,.92,0);
  const noise=new Uint8Array(128*128*4);for(let i=0;i<128*128;i++){const x=Math.sin(i*12.9898+78.233)*43758.5453,c=100+Math.floor((x-Math.floor(x))*100);noise.set([c,c,c,255],i*4);}
  const grain=new THREE.DataTexture(noise,128,128);grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(4,4);grain.needsUpdate=true;material.bumpMap=grain;material.bumpScale=.0011;
  const geo=new THREE.BufferGeometry(),count=19*81,uv:number[]=[],indices:number[]=[];
  geo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(count*3),3));
  for(let j=0;j<=18;j++)for(let i=0;i<=80;i++){const a=i/80*Math.PI*2;uv.push(.5+Math.sin(a)*j/36,.5+Math.cos(a)*j/36);if(j<18&&i<80){const n=j*81+i;indices.push(n,n+81,n+1,n+1,n+81,n+82);}}
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);
  const mortar=mesh(root,'ready-wet-mortar',geo,material),model={group:root,mortar};setWheelbarrowFill(model,1);
  root.userData.capacityLitres=60;root.userData.purpose='Ready mortar supply';return model;
}

export function createConcreteMixer():THREE.Group {
  const root=group('orange-drum-concrete-mixer'),orange=paint(0xd95622,.72,.18),dark=paint(0x252928,.74,.25),steel=paint(0x919792,.49,.62),interior=paint(0x8b2810,.78,.16);
  const frame=group('mixer-stand');root.add(frame);
  // Front telescopic foot, rear axle tripod, and bolted rectangular-tube frame.
  bar(frame,'front-upright',[-.41,.02,-.22],[-.41,1.075,-.22],.030,dark,true);
  bar(frame,'orange-telescopic-post',[-.41,.40,-.22],[-.41,1.09,-.22],.024,orange,true);
  mesh(frame,'front-ground-foot',new THREE.BoxGeometry(.19,.012,.12),dark,[-.41,.014,-.22]);
  bar(frame,'rear-upright',[.40,.44,-.22],[.40,1.09,-.22],.027,orange,true);
  bar(frame,'axle-crossmember',[.10,.172,.36],[.66,.172,.36],.016,dark);
  for(const x of [.10,.66])bar(frame,`rear-tripod-leg-${x}`,[.40,.47,-.22],[x,.172,.36],.027,dark,true);
  bar(frame,'lower-orange-crossmember',[-.41,.44,-.22],[.40,.44,-.22],.025,orange,true);
  bar(frame,'front-diagonal-gusset',[-.41,.62,-.22],[-.22,.44,-.22],.013,orange,true);
  bar(frame,'rear-diagonal-gusset',[.40,.65,-.22],[.21,.44,-.22],.013,orange,true);
  wheel(frame,'left-transport-wheel',.166,.060,[.08,.17,.36],false);
  wheel(frame,'right-transport-wheel',.166,.060,[.68,.17,.36],false);
  for(const s of [-1,1])bar(frame,`external-trunnion-${s}`,[s*.35,1.065,-.22],[s*.49,1.065,-.22],.029,steel);
  for(const x of [-.41,.40])mesh(frame,`bearing-support-${x}`,new RoundedBoxGeometry(.09,.125,.10,2,.009),orange,[x,1.04,-.22]);
  // Drum and cradle pivot together around the horizontal trunnions.
  const cradle=group('tilting-drum-cradle');cradle.position.set(0,1.065,-.22);root.add(cradle);
  tube(cradle,'curved-yoke',[[-.41,0,0],[-.37,-.21,.12],[0,-.30,.17],[.37,-.21,.12],[.40,0,0]],.023,orange);
  const drum=group('hollow-drum');drum.rotation.x=-.95;cradle.add(drum);
  const profile=[[0,-.285],[.145,-.285],[.23,-.257],[.300,-.206],[.339,-.13],[.348,-.06],[.348,.02],[.330,.12],[.302,.24],[.261,.355],[.250,.374],[.241,.371],[.243,.353],[.288,.235],[.316,.119],[.334,.02],[.334,-.059],[.325,-.12],[.287,-.192],[.218,-.242],[.14,-.27],[0,-.27]];
  const shell=lathe(drum,'rolled-steel-drum-shell',profile,orange);
  // Give the genuine inner wall its own dark painted material, not a black cap.
  // LatheGeometry stores profile strips separately for each angular segment.
  const colors:number[]=[];
  // Vertex tint keeps the whole drum in one draw, including its interior.
  for(let i=0;i<=64;i++)for(let j=0;j<profile.length;j++)colors.push(...new THREE.Color(j<=11?0xffffff:0x883f25).toArray());
  shell.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  shell.material=wornPowderCoat(0xd95622,true);
  torus(drum,'rolled-open-mouth',.247,.009,orange,[0,.367,0]);
  torus(drum,'welded-shell-seam',.348,.005,orange,[0,-.025,0]);
  lathe(drum,'cast-ring-gear-band',[[.341,-.105],[.358,-.105],[.358,-.063],[.344,-.063]],dark);
  const teeth:THREE.Matrix4[]=[];for(let i=0;i<84;i++){const a=i/84*Math.PI*2;teeth.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(a)*.361,-.084,Math.cos(a)*.361),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),a),new THREE.Vector3(1,1,1)));}
  copies(drum,'84-ring-gear-teeth',new THREE.BoxGeometry(.015,.032,.012),dark,teeth);
  for(let i=0;i<3;i++){
    const paddle=group(`internal-mixing-paddle-${i}`);paddle.rotation.y=i*Math.PI*2/3;drum.add(paddle);
    const shape=new THREE.Shape();shape.moveTo(.14,-.21);shape.lineTo(.285,-.10);shape.lineTo(.26,.23);shape.lineTo(.19,.25);shape.lineTo(.185,-.04);shape.lineTo(.12,-.14);shape.closePath();
    mesh(paddle,'folded-mixing-fin',new THREE.ExtrudeGeometry(shape,{depth:.012,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.003,bevelThickness:.003}),interior);
    bar(paddle,'paddle-fixing-bracket',[.18,-.18,0],[.26,-.17,0],.012,orange,true);
  }
  // Tilt handwheel in the vertical YZ plane, with spokes and locking quadrant.
  const tilt=group('tilt-wheel-and-lock');tilt.position.set(-.56,1.065,-.22);root.add(tilt);
  torus(tilt,'orange-tilt-handwheel',.265,.014,orange,[0,0,0],'x');
  bar(tilt,'tilt-wheel-hub',[-.034,0,0],[.035,0,0],.046,dark);
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2;bar(tilt,`tilt-wheel-spoke-${i}`,[0,0,0],[0,Math.sin(a)*.252,Math.cos(a)*.252],.011,orange);}
  const plate=mesh(tilt,'locking-quadrant',new THREE.CylinderGeometry(.105,.105,.010,36),steel,[.060,0,0]);plate.rotation.z=Math.PI/2;
  bar(tilt,'spring-loaded-lock-lever',[.04,-.04,.065],[.04,-.29,.095],.009,orange);
  const spring:V[]=Array.from({length:121},(_,i)=>[.04+Math.sin(i/120*Math.PI*18)*.014,-.18+i/120*.1,.095+Math.cos(i/120*Math.PI*18)*.014]);tube(tilt,'exposed-return-spring',spring,.0025,steel);
  // Rounded motor cowling, stand-off mounts, vent slots and unplugged lead.
  mesh(root,'electric-motor-cowling',new RoundedBoxGeometry(.22,.31,.30,3,.035),dark,[.525,1.015,-.05]);
  mesh(root,'motor-orange-mount',new RoundedBoxGeometry(.027,.34,.24,2,.006),orange,[.399,1.014,-.06]);
  const vents:THREE.Matrix4[]=[];for(let i=0;i<8;i++)vents.push(new THREE.Matrix4().makeTranslation(.638,.925+i*.022,-.05));
  copies(root,'motor-vent-recesses',new THREE.BoxGeometry(.0015,.005,.18),paint(0x0e1110,.9,0),vents);
  mesh(root,'motor-switch-surround',new RoundedBoxGeometry(.006,.052,.035,2,.004),steel,[.639,.99,-.16]);
  mesh(root,'green-start-switch',new THREE.BoxGeometry(.008,.021,.021),paint(0x28603b,.6,0),[.643,1.002,-.16]);
  mesh(root,'red-stop-switch',new THREE.BoxGeometry(.008,.019,.021),paint(0xa5261d,.6,0),[.643,.981,-.16]);
  tube(root,'motor-electric-cord',[[.57,.87,.10],[.59,.68,.11],[.60,.43,.14],[.64,.10,.27],[.65,.02,.38],[.72,.03,.48]],.004,paint(0x171c19,.85,0));
  mesh(root,'connected-power-plug',new RoundedBoxGeometry(.035,.036,.055,2,.004),dark,[.72,.033,.49]);
  mesh(root,'site-extension-socket',new RoundedBoxGeometry(.075,.035,.10,2,.009),orange,[.72,.025,.55]);
  tube(root,'site-extension-lead',[[.72,.023,.59],[.73,.007,.66],[.62,.007,.69],[.43,.007,.69]],.005,orange);
  const bolts:THREE.Matrix4[]=[];for(const x of [-.41,.40])for(const y of [.44,1.045]){const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);bolts.push(new THREE.Matrix4().compose(new THREE.Vector3(x,y,-.254),q,new THREE.Vector3(1,1,1)));}
  copies(root,'frame-fasteners',new THREE.CylinderGeometry(.011,.011,.008,6),steel,bolts);
  root.userData.status='Connected, stopped';return root;
}
