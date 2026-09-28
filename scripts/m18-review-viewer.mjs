import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const scene=new THREE.Scene();scene.background=new THREE.Color('#202326');
const camera=new THREE.PerspectiveCamera(36,1,.001,8);camera.position.set(.44,.21,-.46);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,-.027,0);controls.enableDamping=true;controls.minDistance=.15;controls.maxDistance=1.4;
scene.add(new THREE.HemisphereLight(0xffffff,0x515050,2.3));
for(const [position,power]of [[[.3,.6,-.5],3],[[-.4,.2,.3],1.7]]){const light=new THREE.DirectionalLight(0xffffff,power);light.position.fromArray(position);scene.add(light);}
const loader=new GLTFLoader(),models=new Map(),bits=new Map();
for(const [name,data]of Object.entries(window.m18Assets)){
 const asset=await loader.parseAsync(Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer,'');
 asset.scene.traverse(o=>{if(o.isMesh&&o.material.name==='Milwaukee white wordmark'){o.material.transparent=false;o.material.alphaTest=.35;o.material.side=THREE.DoubleSide;}});
 (name.startsWith('m18')?models:bits).set(name,asset.scene);
}
let tool=null,bit=null;
function show(){
 tool?.removeFromParent();bit?.removeFromParent();
 const driver=document.querySelector('#model').value==='fid3';tool=models.get(driver?'m18_fid3':'m18_fpd3');scene.add(tool);
 const select=document.querySelector('#bit');select.options[1].textContent=driver?'PH2 hex bit':'Μύτη 6 mm';select.options[2].disabled=driver;
 if(driver&&select.value==='12')select.value='6';
 const chosen=document.querySelector('#bit').value;
 if(chosen!=='none'){bit=bits.get(driver?'impact_ph2':chosen==='12'?'masonry_12mm':'masonry_6mm');bit.position.set(0,.064,driver?-.055:-.120);scene.add(bit);}else bit=null;
 document.querySelector('#description').textContent=driver?'M18 FID3 · 113 mm · ¼″ hex · τρία LED':'M18 FPD3 · 175 mm · τσοκ 13 mm · πλαϊνή λαβή';
}
document.querySelector('#model').addEventListener('change',show);document.querySelector('#bit').addEventListener('change',show);
document.querySelector('#spin').addEventListener('change',e=>controls.autoRotate=e.target.checked);
document.querySelector('#turn').addEventListener('change',e=>window.turn=e.target.checked);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
show();camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();document.querySelector('#status').textContent='Drag / touch: περιστροφή · wheel / pinch: zoom';
renderer.setAnimationLoop(()=>{if(window.turn&&tool){const rotor=tool.getObjectByName('reference-motor-export');if(rotor)rotor.rotation.z+=.03;if(bit)bit.rotation.z+=.03;}controls.update();renderer.render(scene,camera);});
