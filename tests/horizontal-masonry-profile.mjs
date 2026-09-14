import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createServer } from 'vite';

const output='output/horizontal-masonry-profile';await mkdir(output,{recursive:true});
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
const report={checks:[],bores:[],meshRays:[]};
try{
  const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const {buildMeshJob}=await server.ssrLoadModule('/src/world/masonryMesher.ts');
  const wall=new MasonryVolume({seed:193187}),vertical=new MasonryVolume({seed:193187,hollowProfile:'rounded-five'});
  const pitchX=wall.width/21,pitchY=wall.height/23,row=10,startX=-wall.width/2+10*pitchX,startY=row*pitchY;
  const x=startX+pitchX*.65,depthPitch=(wall.depth-.03)/2,heightPitch=(pitchY-.032)/2;
  assert.equal(wall.options.hollowProfile,'horizontal-rounded');
  const runs=samples=>samples.reduce((count,value,index)=>count+Number(value===0&&(index===0||samples[index-1]!==0)),0);
  for(let bay=0;bay<2;bay++){
    const depth=.015+(bay+.5)*depthPitch,z=wall.frontZ-depth;
    const cross=Array.from({length:240},(_,i)=>wall.sampleMaterial(x,startY+.007+i*(pitchY-.014)/239,z));
    assert.equal(runs(cross),2,'Each depth bay must expose two horizontal bores separated by a horizontal web');
    for(let band=0;band<2;band++){
      const y=startY+.016+(band+.5)*heightPitch;
      const along=Array.from({length:80},(_,i)=>wall.sampleMaterial(startX+.035+i*(pitchX-.070)/79,y,z));
      assert(along.every(material=>material===0),'A horizontal channel must remain open along the brick length, without vertical dividing ribs');
      const hitX=wall.raycast({x,y,z},{x:1,y:0,z:0},.3),hitY=wall.raycast({x,y,z},{x:0,y:1,z:0},.1);
      assert(hitX&&hitY&&hitX.distance>hitY.distance*2,'Physical collision must follow the longer horizontal bore');
      report.bores.push({band,bay,clearHorizontalSamples:along.length,horizontalRayM:hitX.distance,verticalRayM:hitY.distance});
    }
  }
  for(let y=1;y<=wall.ny;y+=3)for(let x=1;x<=wall.nx;x+=3)for(const z of [1,wall.nz])assert.equal(wall.baseMaterial(x,y,z),vertical.baseMaterial(x,y,z),'Correcting the internal extrusion must preserve the front/back clay and mortar facade');
  report.checks.push('four horizontal bores; collision axes match; facade layout and outer shells unchanged');

  // A saved narrow section cut opens both depth bays. This is a material edit,
  // not an overlay or a special mesher: restore exposes the same cavities used
  // by collision and by the actual worker input arrays.
  const section=wall.serialize(),chunks=new Map();
  for(let iy=1;iy<=wall.ny;iy++)for(let ix=1;ix<=wall.nx;ix++){
    const p=wall.nodePosition(ix,iy,1);if(p.x<startX+.025||p.x>startX+.05||p.y<startY+.008||p.y>startY+pitchY-.008)continue;
    for(let iz=1;iz<=wall.nz;iz++){
      if(!wall.baseMaterial(ix,iy,iz))continue;
      const tx=Math.floor(ix/wall.tileSize),ty=Math.floor(iy/wall.tileSize),key=`${tx},${ty}`;
      const offset=((iy-ty*wall.tileSize)*wall.tileSize+ix-tx*wall.tileSize)*(wall.nz+2)+iz;
      if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push([offset,255,1]);
    }
  }
  section.chunks=[...chunks].map(([key,edits])=>({key,edits}));wall.restore(section);
  const meshes=[],material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  for(const key of wall.takeDirtyChunks()){
    const job=wall.exportMeshJob(key),data=buildMeshJob(job);
    for(let iy=job.y0;iy<=job.y1;iy++)for(let ix=job.x0;ix<=job.x1;ix++)for(let iz=0;iz<wall.nz+2;iz++){
      const index=((iy-job.y0)*(job.x1-job.x0+1)+ix-job.x0)*(wall.nz+2)+iz;
      assert.equal(job.materials[index],wall.nodeMaterial(ix,iy,iz),'Worker occupancy must be the authoritative collision field');
    }
    if(!data.positions.length)continue;
    const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(data.positions,3));
    const mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld(true);meshes.push(mesh);
  }
  assert(meshes.length>0);
  for(let bay=0;bay<2;bay++)for(let band=0;band<2;band++)for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0)]){
    const origin=new THREE.Vector3(x,startY+.016+(band+.5)*heightPitch,wall.frontZ-.015-(bay+.5)*depthPitch);
    const physical=wall.raycast(origin,direction,.3),visible=new THREE.Raycaster(origin,direction,0,.3).intersectObjects(meshes)[0];
    assert(physical&&visible,'An exposed horizontal bore must have both visible and physical walls');
    assert(Math.abs(physical.distance-visible.distance)<.00005,'Worker mesh and collision must meet at the same bore surface');
    report.meshRays.push({band,bay,axis:direction.x?'X':'Y',collisionM:physical.distance,meshM:visible.distance});
  }
  report.checks.push('section cut exposes real horizontal tunnels; worker material parity; eight mesh/collision ray matches');

  for(const profile of ['horizontal-rounded','rounded-five','legacy-rectangular']){
    const original=new MasonryVolume({seed:8721,hollowProfile:profile});
    for(let blow=0;blow<8;blow++){
      const hit=original.raycast({x:.72+blow*.004,y:1.55,z:-2},{x:0,y:0,z:-1},.8);
      if(hit)original.impact({point:hit.point,direction:{x:0,y:0,z:-1},chisel:'flat',energyJ:4});
    }
    const saved=original.serialize(),restored=new MasonryVolume({seed:8721});restored.restore(saved);
    assert.equal(restored.options.hollowProfile,profile);assert.deepEqual(restored.serialize(),saved);
    for(let iy=185;iy<200;iy++)for(let ix=460;ix<485;ix++)for(let iz=1;iz<=original.nz;iz++)assert.equal(restored.nodeMaterial(ix,iy,iz),original.nodeMaterial(ix,iy,iz));
    if(profile==='legacy-rectangular'){delete saved.options.hollowProfile;restored.restore(saved);assert.equal(restored.options.hollowProfile,'legacy-rectangular');}
  }
  report.checks.push('real impacts save/restore for new and both historical profiles; untagged old saves remain legacy');
  report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await server.close();}
