import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
 const {ElectricalBox}=await server.ssrLoadModule('/src/electrical/Box.ts');
 const {BoxGroup}=await server.ssrLoadModule('/src/electrical/BoxGroup.ts');
 for(const kind of ['1G','2G']){
  const box=new ElectricalBox(kind,kind);box.position.set(.4,1.1,-2.4);box.updateMatrixWorld(true);
  const bottom=box.getObjectByName('Lower casing wall with two open 20 mm conduit entrances');
  assert.equal(box.bottomConduitEntries.length,2);
  for(const entry of box.bottomConduitEntries){
   for(let i=0;i<16;i++){
    const angle=i/16*Math.PI*2,origin=entry.clone().add(new THREE.Vector3(Math.cos(angle)*.01,-.02,Math.sin(angle)*.01));
    const ray=new THREE.Raycaster(box.localToWorld(origin),new THREE.Vector3(0,1,0),0,.03);
    assert.equal(ray.intersectObject(bottom).length,0,`${kind}: the entire 20 mm pipe section must pass through the lower casing`);
   }
  }
  const solid=new THREE.Raycaster(box.localToWorld(new THREE.Vector3(0,-box.height/2-.02,box.bottomConduitEntries[0].z)),new THREE.Vector3(0,1,0),0,.03);
  assert(solid.intersectObject(bottom).length>0,'The bridge between the two entrances stays solid');
 }
 const group=new BoxGroup(['2G','1G'],'combined');group.position.set(1,.8,-2.4);group.rotation.z=.015;
 const entries=group.getBottomConduitEntries();assert.equal(entries.length,4);assert(entries.every((e,i)=>i===0||e.position.x>entries[i-1].position.x));
 const stacked=new BoxGroup(['2G','1G'],'stacked',[{id:'lower',kind:'2G',x:0,y:0,rotation:0},{id:'upper',kind:'1G',x:0,y:.082,rotation:0}]);
 assert.equal(stacked.getBottomConduitEntries().length,2,'Only the exposed bottom row offers entrances');
 assert(stacked.getBottomConduitEntries().every(e=>e.boxIndex===0));
 console.log('PASS: both 20 mm lower entrances pass a full pipe section, the casing bridge stays solid, transforms and stacked assemblies retain real entry locations');
}finally{await server.close();}
