import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export type M18ToolKind='drill'|'driver';
export interface M18ToolOptions{bitDiameterMm?:6|12}
const assets=new Map<string,Promise<THREE.Group>>();
const pending:Promise<void>[]=[];

/** Immutable shared meshes/materials; every tool owns its rigid chuck transform. */
function load(name:string):Promise<THREE.Group>{
 let task=assets.get(name);
 if(!task){
  task=new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/tools/milwaukee-m18/${name}.glb`).then(asset=>{
   asset.scene.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    o.renderOrder=20;o.castShadow=false;o.receiveShadow=false;o.frustumCulled=false;o.userData.toolModelPart=true;
    const materials=Array.isArray(o.material)?o.material:[o.material];
    for(const material of materials){
     if(material instanceof THREE.MeshStandardMaterial&&material.map){material.map.anisotropy=4;}
     if(material.name==='Milwaukee white wordmark'){material.transparent=false;material.alphaTest=.35;material.depthWrite=true;material.side=THREE.DoubleSide;}
    }
   });
   return asset.scene;
  });
  assets.set(name,task);
 }
 return task;
}

/** Wait for all instances and their bits before the site's READY state. */
export function m18ToolModelsReady():Promise<void>{return Promise.all(pending).then(()=>{});}

/** Metres, +Y up, -Z working direction. Grip/tip datums are never scaled to fit. */
export function buildM18ToolModel(kind:M18ToolKind,options:M18ToolOptions={}):THREE.Group{
 const drill=kind==='drill',model=drill?'FPD3':'FID3',diameter=options.bitDiameterMm??6;
 const face=drill?-.120:-.055,datum=drill?-.075:-.045,length=drill?.145:.070;
 const group=new THREE.Group();group.name=`Milwaukee M18 ${model}`;
 Object.assign(group.userData,{
  productModel:`Milwaukee M18 ${model}`,bodyLengthMm:drill?175:113,
  gripPoint:[0,-.005,.011],tipPoint:[0,.064,face-length],bitDiameterMm:drill?diameter:6.35,
  secondaryGripPoint:drill?[-.122,.083,-.035]:undefined,
  referenceUrl:`https://www.milwaukeetool.eu/en-eu/${drill?'m18-fuel-percussion-drill/m18-fpd3':'m18-fuel-1-4-hex-impact-driver/m18-fid3'}/`,
  visualAsset:`assets/tools/milwaukee-m18/m18_${model.toLowerCase()}.glb`,modelLoaded:false,
 });
 // FPSRig retains this object at construction; loading must never replace it.
 const motor=new THREE.Group();motor.name='reference-motor';motor.position.set(0,.064,datum);group.add(motor);
 const task=Promise.all([load(`m18_${model.toLowerCase()}`),load(drill?`masonry_${diameter}mm`:'impact_ph2')]).then(([source,accessory])=>{
  const shell=source.clone(true);shell.name=`M18 ${model} fixed housing`;
  const rotor=shell.getObjectByName('reference-motor-export');
  if(!rotor)throw new Error(`M18 ${model} export has no chuck pivot`);
  for(const child of [...rotor.children])motor.add(child);
  rotor.removeFromParent();
  shell.traverse(o=>{if(/^Index[ _]finger[ _]trigger/.test(o.name))o.name='Index finger trigger';});
  group.add(shell);
  const bit=accessory.clone(true);bit.name=drill?`${diameter} mm masonry drill bit`:'PH2 impact rated hex screwdriver bit';
  bit.position.z=face-datum;motor.add(bit);group.userData.modelLoaded=true;
 });
 pending.push(task);
 return group;
}
