import * as THREE from 'three';

/** A reusable pencil model centred on the fingers, with its graphite tip at +Y. */
export function buildMeasurePencil():THREE.Group {
  const pencil=new THREE.Group();pencil.name='Carpenter pencil in left hand';
  const lacquer=new THREE.MeshStandardMaterial({color:0xd94d30,roughness:.65});
  const wood=new THREE.MeshStandardMaterial({color:0xd9b67b,roughness:.86});
  const graphite=new THREE.MeshStandardMaterial({color:0x292723,roughness:.85});
  const part=(name:string,geometry:THREE.BufferGeometry,material:THREE.Material,y:number)=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.y=y;mesh.renderOrder=20;mesh.receiveShadow=true;pencil.add(mesh);return mesh;
  };
  part('Flat orange carpenter pencil',new THREE.BoxGeometry(.010,.138,.006),lacquer,.005);
  const timber=part('Sharpened cedar wood',new THREE.ConeGeometry(.006,.019,4),wood,.0835);timber.scale.z=.65;
  const lead=part('Graphite marking point',new THREE.ConeGeometry(.0018,.005,6),graphite,.0955);lead.scale.z=.65;
  part('Exposed pencil end grain',new THREE.BoxGeometry(.010,.001,.006),wood,-.0645);
  const tip=new THREE.Object3D();tip.name='pencil-graphite-tip';tip.position.y=.098;pencil.add(tip);
  pencil.userData.tipPoint=[0,.098,0];return pencil;
}

/** Metre-scale casing. The blade leaves the lower left slot at local (0, 0, 0). */
export function buildTapeMeasureModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Five metre site tape measure';
  const yellow = new THREE.MeshStandardMaterial({color: 0xf1bf22, roughness: .48});
  const rubber = new THREE.MeshStandardMaterial({color: 0x242927, roughness: .88});
  const steel = new THREE.MeshStandardMaterial({color: 0xbfc7c4, roughness: .34, metalness: .65});
  const part = (name:string, geometry:THREE.BufferGeometry, material:THREE.Material, x:number, y:number, z:number):THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.position.set(x, y, z); mesh.renderOrder = 20;
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.toolModelPart = true;
    group.add(mesh); return mesh;
  };
  const shell = (width:number, height:number, depth:number, radius:number):THREE.ExtrudeGeometry => {
    const x=-width/2,y=-height/2,s=new THREE.Shape();
    s.moveTo(x+radius,y);s.lineTo(x+width-radius,y);s.quadraticCurveTo(x+width,y,x+width,y+radius);
    s.lineTo(x+width,y+height-radius);s.quadraticCurveTo(x+width,y+height,x+width-radius,y+height);
    s.lineTo(x+radius,y+height);s.quadraticCurveTo(x,y+height,x,y+height-radius);
    s.lineTo(x,y+radius);s.quadraticCurveTo(x,y,x+radius,y);s.closePath();
    const geometry=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelThickness:.001,bevelSize:.001,bevelSegments:2,curveSegments:6,steps:1});
    geometry.translate(0,0,-depth/2);return geometry;
  };
  part('Impact resistant rubber perimeter',shell(.077,.072,.036,.018),rubber,.026,.038,.026);
  part('Yellow moulded front case',shell(.069,.064,.003,.016),yellow,.026,.038,.045);
  part('Yellow moulded back case',shell(.069,.064,.003,.016),yellow,.026,.038,.007);
  part('Stainless tape outlet',new THREE.BoxGeometry(.031,.007,.006),steel,0,.002,.003);
  part('Dark tape slot',new THREE.BoxGeometry(.028,.003,.001),rubber,0,.0005,-.0001);
  part('Thumb blade lock',shell(.018,.025,.007,.004),rubber,-.004,.048,.050);
  for(let i=0;i<4;i++)part('Thumb lock traction ridge',new THREE.BoxGeometry(.014,.0015,.0015),steel,-.004,.041+i*.004,.054);
  part('Quick stop button',shell(.019,.007,.012,.003),yellow,.027,.001,.027);
  part('Steel belt clip spine',new THREE.BoxGeometry(.005,.030,.003),steel,.065,.040,.032);
  part('Steel belt clip spring',new THREE.BoxGeometry(.005,.024,.002),steel,.070,.036,.032);
  part('Steel belt clip bend',new THREE.BoxGeometry(.009,.004,.004),steel,.067,.054,.032);
  for(const [x,y] of [[.044,.058],[.045,.016]]){
    const head=part('Recessed case screw',new THREE.CylinderGeometry(.002,.002,.0012,10),steel,x,y,.048);
    head.rotation.x=Math.PI/2;
    part('Case screw slot',new THREE.BoxGeometry(.0025,.0005,.0003),rubber,x,y,.0488);
  }
  // Printed markings use one small texture, never per-frame text geometry.
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const context=canvas.getContext('2d');
    if(context){
      context.fillStyle='#242927';context.fillRect(0,0,256,256);
      context.fillStyle='#f4c732';context.textAlign='center';context.textBaseline='middle';
      context.font='bold 108px Arial';context.fillText('5 m',128,105);
      context.fillStyle='#f6f1df';context.font='bold 31px Arial';context.fillText('28 mm',128,190);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      part('Printed five metre identification',new THREE.PlaneGeometry(.031,.031),new THREE.MeshStandardMaterial({map:texture,roughness:.65}),.033,.037,.0471);
    }
  }
  const outlet=new THREE.Object3D();outlet.name='tape-blade-outlet';group.add(outlet);
  group.userData.gripPoint=[.039,.041,.026];
  group.userData.tipPoint=[0,0,0];
  group.userData.bladeWidthM=.028;
  group.userData.caseDimensionsM=[.077,.072,.036];
  return group;
}
