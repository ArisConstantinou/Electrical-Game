import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ReferenceToolKind='drill'|'driver'|'laser';

/** Shared metre-scale handheld and installed reference tools; +Z faces the worker. */
export function buildReferenceToolModel(kind:ReferenceToolKind):THREE.Group {
  const group=new THREE.Group();group.name=`Site ${kind}`;
  const black=new THREE.MeshStandardMaterial({color:0x202725,roughness:.83});
  const paint=new THREE.MeshStandardMaterial({color:kind==='drill'?0xbf3429:kind==='driver'?0x287fa1:0x67a82d,roughness:.48});
  const steel=new THREE.MeshStandardMaterial({color:0xaab4b5,metalness:.60,roughness:.38});
  const part=(parent:THREE.Group,name:string,geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number)=>{
    // Moulded shells and rubber guards need radiused edges at hand distance.
    // Keep optical faces, metal plates and tiny switch details flat.
    if(geometry instanceof THREE.BoxGeometry&&/housing|bumper|guard|pistol grip|battery|Battery|latch|foot/i.test(name)){
      const {width,height,depth}=geometry.parameters;geometry.dispose();
      geometry=new RoundedBoxGeometry(width,height,depth,2,Math.min(width,height,depth)*.16);
    }
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.set(x,y,z);mesh.renderOrder=20;mesh.receiveShadow=true;mesh.castShadow=false;mesh.userData.toolModelPart=true;parent.add(mesh);return mesh;
  };
  if(kind==='laser'){
    group.name='Milwaukee M12 3PL green 360 degree laser';
    group.userData.referenceUrl='https://www.milwaukeetool.eu/en-eu/m12-green-360-176;-3-plane-laser/m12-3pl/';
    group.userData.productModel='Milwaukee M12 3PL';
    const red=new THREE.MeshStandardMaterial({color:0xc9212c,roughness:.56});
    const softBlack=new THREE.MeshStandardMaterial({color:0x343537,roughness:.93});
    const glass=new THREE.MeshStandardMaterial({color:0x88adae,metalness:.35,roughness:.16,transparent:true,opacity:.66,depthWrite:false});
    const profile=(name:string,points:number[][],depth:number,z:number,material:THREE.Material)=>{
      const shape=new THREE.Shape();shape.moveTo(points[0][0],points[0][1]);for(const point of points.slice(1))shape.lineTo(point[0],point[1]);shape.closePath();
      const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.0015,bevelThickness:.0015,bevelSegments:2,steps:1,curveSegments:3});
      return part(group,name,geometry,material,0,0,z);
    };
    // The datum remains the exposed screw beside the unit. The high optical
    // turret shares its Y=0 plane while the recognisable M12 body sits below it.
    part(group,'Laser wall mounting plate',new THREE.BoxGeometry(.231,.023,.009),black,.0975,0,.0045);
    part(group,'Magnetic mount rear upright',new THREE.BoxGeometry(.019,.160,.011),black,.202,-.066,.010);
    part(group,'Wide pivoting mounting foot',new THREE.BoxGeometry(.167,.013,.097),softBlack,.125,-.151,.052);
    profile('Angular rubber armoured M12 shell',[[.053,-.142],[.202,-.142],[.207,-.099],[.167,-.081],[.133,-.033],[.121,-.018],[.069,-.018],[.054,-.037]],.064,.019,softBlack);
    profile('Slanted red Milwaukee side panel',[[.065,-.039],[.124,-.024],[.151,-.061],[.145,-.077],[.130,-.076],[.119,-.105],[.065,-.105]],.004,.085,red);
    profile('Red selector shoulder',[[.117,-.105],[.128,-.073],[.150,-.073],[.173,-.085],[.177,-.093],[.143,-.084],[.133,-.109]],.004,.087,red);
    part(group,'Battery housing rubber block',new THREE.BoxGeometry(.040,.045,.068),black,.183,-.118,.051);
    for(let i=0;i<7;i++)part(group,'M12 battery housing grip ridge',new THREE.BoxGeometry(.032,.0025,.0035),softBlack,.184,-.099-i*.006,.087);
    part(group,'Base battery latch',new THREE.BoxGeometry(.050,.018,.005),black,.143,-.133,.090);
    const selectorRing=part(group,'Red pendulum lock selector rim',new THREE.TorusGeometry(.0155,.0021,6,24),red,.142,-.102,.091);
    selectorRing.rotation.z=.10;
    const selector=part(group,'Round pendulum lock selector',new THREE.CylinderGeometry(.014,.014,.004,24),black,.142,-.102,.091);selector.rotation.x=Math.PI/2;
    part(group,'Selector raised thumb lever',new THREE.BoxGeometry(.004,.024,.005),softBlack,.142,-.102,.096);
    const arrow=new THREE.Shape();arrow.moveTo(-.002,0);arrow.lineTo(.002,0);arrow.lineTo(0,.003);arrow.closePath();
    part(group,'Selector white direction arrow',new THREE.ShapeGeometry(arrow),new THREE.MeshStandardMaterial({color:0xe5e4df,roughness:.8}),.142,-.092,.099);
    part(group,'Mode switch panel',new THREE.BoxGeometry(.023,.018,.004),red,.077,-.091,.091);
    part(group,'Horizontal plane button',new THREE.BoxGeometry(.009,.009,.003),black,.080,-.091,.095);
    part(group,'Vertical plane button',new THREE.BoxGeometry(.005,.009,.003),black,.070,-.091,.095);
    part(group,'Horizontal button white symbol',new THREE.BoxGeometry(.0055,.001,.001),steel,.080,-.091,.097);
    part(group,'Vertical button white symbol',new THREE.BoxGeometry(.001,.0055,.001),steel,.070,-.091,.097);
    for(let i=0;i<4;i++){
      const led=part(group,'Battery status indicator',new THREE.CylinderGeometry(.0009,.0009,.001,6),i===0?red:black,.070+i*.004,-.103,.094);led.rotation.x=Math.PI/2;
    }
    const wheel=part(group,'Knurled fine adjustment wheel',new THREE.CylinderGeometry(.010,.010,.009,24),black,.096,-.133,.093);wheel.rotation.x=Math.PI/2;
    for(let i=0;i<12;i++)part(group,'Fine adjustment knurl',new THREE.BoxGeometry(.0018,.0025,.009),softBlack,.096+Math.cos(i*Math.PI/6)*.010,-.133+Math.sin(i*Math.PI/6)*.010,.094);
    // The top guarded cylindrical glass module identifies the 360-degree
    // horizontal emitter. The two side modules remain unlit in this workflow.
    const turretX=.090,turretZ=.056;
    part(group,'Top optical turret lower guard',new THREE.BoxGeometry(.054,.009,.052),black,turretX,-.015,turretZ);
    part(group,'Top optical turret upper guard',new THREE.BoxGeometry(.048,.009,.047),softBlack,turretX,.018,turretZ);
    part(group,'Horizontal laser lens',new THREE.CylinderGeometry(.018,.018,.019,24,1,true),new THREE.MeshStandardMaterial({color:0x74938a,metalness:.28,roughness:.18,transparent:true,opacity:.72,depthWrite:false,emissive:0x188f20,emissiveIntensity:0}),turretX,0,turretZ);
    const upperOptic=part(group,'Top conical mirror',new THREE.ConeGeometry(.012,.008,20),steel,turretX,.007,turretZ);upperOptic.rotation.z=Math.PI;
    part(group,'Lower optical spindle',new THREE.CylinderGeometry(.0035,.006,.010,12),black,turretX,-.006,turretZ);
    for(const sx of [-1,1])for(const sz of [-1,1]){
      const guard=part(group,'Top turret impact guard post',new THREE.BoxGeometry(.006,.032,.006),softBlack,turretX+sx*.022,.001,turretZ+sz*.021);guard.rotation.z=-sx*.12;
    }
    for(const side of [-1,1]){
      const x=side<0?.046:.134,y=side<0?-.047:-.051,z=.054;
      part(group,side<0?'Left vertical optical window':'Right vertical optical window',new THREE.BoxGeometry(.004,.034,.028),glass,x,y,z);
      for(const dz of [-.018,.018])part(group,'Side turret impact guard upright',new THREE.BoxGeometry(.010,.046,.006),black,x,y,z+dz);
      for(const dy of [-.022,.022])part(group,'Side turret impact guard cap',new THREE.BoxGeometry(.010,.006,.039),softBlack,x,y+dy,z);
      const optic=part(group,'Inactive vertical plane mirror',new THREE.ConeGeometry(.006,.007,10),steel,x,y,z);optic.rotation.z=side*Math.PI/2;
    }
    if(typeof document!=='undefined'){
      const print=(name:string,width:number,height:number,x:number,y:number,draw:(ctx:CanvasRenderingContext2D)=>void,z=.0915)=>{
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const ctx=canvas.getContext('2d');if(!ctx)return;
        draw(ctx);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
        part(group,name,new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.05,roughness:.75,depthWrite:false}),x,y,z);
      };
      print('White Milwaukee wordmark and lightning',.064,.032,.100,-.055,ctx=>{
        ctx.fillStyle='#ffffff';ctx.font='italic bold 82px "Brush Script MT", "Segoe Script", cursive';ctx.textAlign='center';ctx.fillText('Milwaukee',252,140,490);
        ctx.beginPath();ctx.moveTo(20,214);ctx.lineTo(203,164);ctx.lineTo(180,188);ctx.lineTo(465,159);ctx.lineTo(333,213);ctx.lineTo(355,191);ctx.lineTo(169,222);ctx.lineTo(182,204);ctx.closePath();ctx.fill();
      });
      print('M12 product badge',.024,.011,.151,-.134,ctx=>{ctx.fillStyle='#202122';ctx.fillRect(0,0,512,256);ctx.fillStyle='#e5e5e2';ctx.font='italic bold 156px Arial';ctx.textAlign='center';ctx.fillText('M12',256,188);},.094);
    }
    const screw=part(group,'Mounting plate fixing screw',new THREE.CylinderGeometry(.004,.004,.003,12),steel,0,0,.012);screw.rotation.x=Math.PI/2;
    part(group,'Fixing screw cross slot',new THREE.BoxGeometry(.005,.001,.0005),black,0,0,.0137);
    part(group,'Fixing screw cross slot second edge',new THREE.BoxGeometry(.001,.005,.0005),black,0,0,.0137);
    group.userData.gripPoint=[.175,-.101,.059];group.userData.tipPoint=[turretX,0,turretZ+.018];group.userData.mountingPoint=[0,0,0];
    return group;
  }
  const drill=kind==='drill',bodyLength=drill?.135:.092;
  part(group,'Rubber pistol grip',new THREE.BoxGeometry(.039,.089,.043),black,0,-.008,.011);
  part(group,'Grip colour inlay',new RoundedBoxGeometry(.034,.068,.014,2,.005),paint,0,-.009,.032);
  part(group,'Battery pack rubber base',new THREE.BoxGeometry(.077,.040,.084),black,0,-.070,.016);
  part(group,'Battery latch',new THREE.BoxGeometry(.080,.018,.027),paint,0,-.059,.038);
  // A tapered motor shell, narrow gearbox and swept grip shoulder replace
  // the uniform red barrel. Anchor/bit datums stay in metre space.
  const profile=[new THREE.Vector2(0,0),new THREE.Vector2(.027,0),new THREE.Vector2(.034,.008),new THREE.Vector2(.037,.028),new THREE.Vector2(.035,bodyLength*.64),new THREE.Vector2(.029,bodyLength-.015),new THREE.Vector2(.026,bodyLength),new THREE.Vector2(0,bodyLength)];
  const body=part(group,drill?'Cordless drill motor housing':'Compact impact driver housing',new THREE.LatheGeometry(profile,24),paint,0,.064,-.011);body.rotation.x=-Math.PI/2;
  part(group,'Rear motor bumper',new THREE.BoxGeometry(.059,.058,.014),black,0,.064,-.007);
  const shoulder=part(group,'Contoured motor grip shoulder',new RoundedBoxGeometry(.042,.051,.067,2,.011),paint,0,.024,-.015);shoulder.rotation.x=-.15;
  for(const side of [-1,1]){
    for(let i=0;i<5;i++){const vent=part(group,'Recessed motor ventilation slot',new RoundedBoxGeometry(.003,.020,.0035,1,.001),black,side*.033,.063,-.029-i*.008);vent.rotation.x=-.22;}
    for(let i=0;i<4;i++)part(group,'Grip rubber traction rib',new RoundedBoxGeometry(.002,.002,.028,1,.0008),black,side*.020,-.024+i*.009,.010);
    for(const z of [-.023,-.070]){const screw=part(group,'Recessed motor screw',new THREE.CylinderGeometry(.002,.002,.0015,8),steel,side*.034,.048,z);screw.rotation.z=Math.PI/2;}
  }
  part(group,'Index finger trigger',new THREE.BoxGeometry(.022,.021,.013),black,0,.018,-.019);
  part(group,'Forward reverse switch',new THREE.BoxGeometry(.047,.009,.013),black,0,.031,-.020);
  const motor=new THREE.Group();motor.name='reference-motor';motor.position.set(0,.064,-.012-bodyLength);group.add(motor);
  const collar=part(group,'Fixed torque selection collar',new THREE.CylinderGeometry(.027,.029,.023,32),black,0,.064,motor.position.z+.010);collar.rotation.x=Math.PI/2;
  for(let i=0;i<16;i++){const a=i*Math.PI/8;const rib=part(group,'Torque collar grip rib',new THREE.BoxGeometry(.002,.003,.017),steel,Math.cos(a)*.028,.064+Math.sin(a)*.028,motor.position.z+.010);rib.rotation.z=a-Math.PI/2;}
  const led=part(group,'Trigger work light lens',new RoundedBoxGeometry(.012,.005,.002,1,.001),new THREE.MeshStandardMaterial({color:0xe9e7d4,roughness:.24}),0,.032,-.043);led.rotation.x=-.2;
  const chuck=part(motor,drill?'Keyless masonry drill chuck':'Quick release hex collet',new THREE.CylinderGeometry(drill?.019:.013,drill?.025:.019,drill?.043:.029,16),drill?black:steel,0,0,-.016);chuck.rotation.x=Math.PI/2;
  const length=drill?.145:.070,tipZ=-.038-length;
  const bit=part(motor,drill?'Long masonry drill bit':'Short hex screwdriver bit',new THREE.CylinderGeometry(drill?.003:.0035,drill?.003:.0035,length,drill?12:6),steel,0,0,-.038-length/2);bit.rotation.x=Math.PI/2;
  if(drill){
    for(const phase of [0,Math.PI]){
      const points=Array.from({length:97},(_,i)=>{const t=i/96,a=phase+t*Math.PI*16;return new THREE.Vector3(Math.cos(a)*.0031,Math.sin(a)*.0031,-.050-t*.120);});
      part(motor,'Continuous masonry bit helical cutting land',new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),96,.00065,4,false),steel,0,0,0);
    }
    part(motor,'Carbide masonry cutting head',new THREE.BoxGeometry(.008,.0025,.005),steel,0,0,tipZ);
  }else{
    part(motor,'Phillips cross tip',new THREE.BoxGeometry(.0045,.0015,.006),steel,0,0,tipZ);
    part(motor,'Phillips cross tip second edge',new THREE.BoxGeometry(.0015,.0045,.006),steel,0,0,tipZ);
  }
  group.userData.gripPoint=[0,-.005,.011];group.userData.tipPoint=[0,.064,motor.position.z+tipZ-(drill?.0025:.003)];
  if(drill){
    // Keep the proven grip, trigger and rotating masonry bit datums. The
    // photographed shell is visual only, so an asset load failure leaves the
    // working drill intact rather than removing the tool from gameplay.
    new GLTFLoader().load(`${import.meta.env.BASE_URL}assets/tools/drill-01/Drill_01_1k.gltf`,asset=>{
      const shell=asset.scene;
      shell.name='Photographed cordless drill shell';
      shell.rotation.y=-Math.PI/2;
      shell.position.set(0,-.09,-.05);
      shell.traverse(object=>{
        if(object instanceof THREE.Mesh){
          object.renderOrder=20;
          object.castShadow=false;
          object.receiveShadow=false;
          object.frustumCulled=false;
        }
      });
      group.children.filter(child=>child.userData.toolModelPart===true).forEach(child=>{child.visible=false;});
      motor.getObjectByName('Keyless masonry drill chuck')!.visible=false;
      group.add(shell);
      group.userData.visualAsset='Poly Haven Drill 01 1K glTF CC0';
    },undefined,error=>{console.warn('Drill shell unavailable; retaining functional drill model',error);});
  }
  return group;
}
