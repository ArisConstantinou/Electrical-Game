import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';

const out='output/hammer-facing/depth-guard';await mkdir(out,{recursive:true});
const source=execFileSync('git',['show','ea4216c:src/world/MasonryVolume.ts'],{encoding:'utf8'});
await writeFile(`${out}/Before.ts`,source.replace("'./masonryMesher'","'/src/world/masonryMesher'"));
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,entries:[]},appType:'custom',logLevel:'error'}),report=[];
try{
 const {MasonryVolume:Before}=await server.ssrLoadModule(`/${out}/Before.ts`);
 const {MasonryVolume:After,SERVICE_CHASE_DEPTH_M}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
 assert.equal(SERVICE_CHASE_DEPTH_M,.075);
 for(const front of [true,false])for(const seed of [1234,193187]){
  const results=[];
  for(const [version,Volume] of [['before',Before],['after',After]]){
   const v=new Volume({width:.30,height:.30,depth:.18,cellSize:.008,solidMaterial:1,seed}),saved=v.serialize(),chunks=new Map();
   // A real saved deep recess exposes a backing beyond the permitted service
   // depth. A later blow from the same facade must preserve that backing.
   for(let y=1;y<=v.ny;y++)for(let x=1;x<=v.nx;x++)for(let z=1;z<=v.nz;z++){
    const p=v.nodePosition(x,y,z),depth=front?v.frontZ-p.z:p.z-(v.frontZ-v.depth);
    if(Math.abs(p.x)>.065||Math.abs(p.y-.15)>.065||depth>.125)continue;
    const tx=Math.floor(x/v.tileSize),ty=Math.floor(y/v.tileSize),key=`${tx},${ty}`;
    if(!chunks.has(key))chunks.set(key,[]);
    const offset=((y-ty*v.tileSize)*v.tileSize+x-tx*v.tileSize)*(v.nz+2)+z;chunks.get(key).push([offset,255,1]);
   }
   saved.chunks=[...chunks].map(([key,edits])=>({key,edits}));v.restore(saved);
   const direction={x:0,y:0,z:front?-1:1},origin={x:0,y:.15,z:front?v.frontZ+.02:v.frontZ-v.depth-.02};
   let removed=0,weakened=0;
   for(let i=0;i<8;i++){const hit=v.raycast(origin,direction,.4);assert(hit);const impact=v.impact({point:hit.point,direction,edge:{x:1,y:0,z:0},chisel:'flat',widthM:.05,energyJ:4,maxDepthM:SERVICE_CHASE_DEPTH_M});removed+=impact.removedNodes;weakened+=impact.stats.weakenedNodes;}
   results.push({version,removed,weakened});
  }
  assert(results[0].removed>0,'Bug fixture must fail on the previous contact-position guard');
  assert.equal(results[1].removed,0,'Incoming work side must retain a deep backing');
  assert.equal(results[1].weakened,0,'Protected backing must not accumulate hidden damage');
  report.push({front,seed,results});
 }
 await writeFile(`${out}/report.json`,JSON.stringify({passed:true,cases:report},null,2));console.log(JSON.stringify({passed:true,cases:report}));
}finally{await server.close();}

\n