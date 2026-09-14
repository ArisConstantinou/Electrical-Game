import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
const output='output/masonry-sustained-performance',baselineRef='216a3e3';
await mkdir(output,{recursive:true});
const original=execFileSync('git',['show',`${baselineRef}:src/world/MasonryVolume.ts`],{encoding:'utf8'});
await writeFile(`${output}/MasonryVolume.baseline.ts`,original.replace("'./masonryMesher'","'/src/world/masonryMesher'"));
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
const stats=a=>{a=[...a].sort((x,y)=>x-y);return {samples:a.length,totalMs:a.reduce((x,y)=>x+y,0),medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maximumMs:a.at(-1)};};
const metadata=r=>r&&({...r,removedVolume:0,fragments:r.fragments.map(f=>({...f,volume:0,positions:undefined})),stats:{...r.stats,milliseconds:0}});
const report={baselineRef,cases:[],checks:['same hit, removed nodes, cracks, fragment bounds and material','same saved edits, support and worker mesh snapshots','bounded floating point mass equivalence','unmodified generic tetra clipper oracle in masonry-removal-clipper and masonry-impact-equivalence']};
try {
 const{MasonryVolume:Before}=await server.ssrLoadModule(`/${output}/MasonryVolume.baseline.ts`);
 const{MasonryVolume:After}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
 const total=[[],[]],aggregate=[[],[]],snapshots=[[],[]];
 for(const seed of [1234,193187,8721])for(const tilt of [.25,.55]) {
  const walls=[new Before({seed}),new After({seed})],times=[[],[]],fragmentTimes=[[],[]];
  for(let version=0;version<2;version++){const fn=walls[version].aggregateFragments.bind(walls[version]);walls[version].aggregateFragments=(...args)=>{const t=performance.now();const result=fn(...args);fragmentTimes[version].push(performance.now()-t);return result;};}
  for(let blow=0;blow<100;blow++) {
   const x=.65+(blow%20)*.015,y=1.55+Math.floor(blow/20)*.025,direction={x:0,y:-tilt,z:-Math.sqrt(1-tilt*tilt)};
   const origin={x,y:y+.1,z:walls[0].frontZ+.38},hit=walls[0].raycast(origin,direction,.8);
   assert.deepEqual(walls[1].raycast(origin,direction,.8),hit);if(!hit)continue;
   const input={point:hit.point,direction,edge:{x:1,y:0,z:0},energyJ:4,chisel:'flat',widthM:.05},results=[];
   for(const version of blow%2?[1,0]:[0,1]){const t=performance.now();results[version]=walls[version].impact(input);times[version].push(performance.now()-t);}
   assert.deepEqual(metadata(results[1]),metadata(results[0]));
   assert(Math.abs(results[1].removedVolume-results[0].removedVolume)<1e-14);
   for(let i=0;i<results[0].fragments.length;i++)assert(Math.abs(results[1].fragments[i].volume-results[0].fragments[i].volume)<1e-14);
   const dirty=walls[0].takeDirtyChunks();assert.deepEqual(walls[1].takeDirtyChunks(),dirty);
   for(const key of dirty){const jobs=[];for(let version=0;version<2;version++){const t=performance.now();jobs[version]=walls[version].exportMeshJob(key);snapshots[version].push(performance.now()-t);}assert.deepEqual(jobs[1],jobs[0]);}
   for(let tick=0;tick<5;tick++){const a=walls[0].processPendingSupport(2048),b=walls[1].processPendingSupport(2048);assert.deepEqual(metadata(b),metadata(a));if(a)assert(Math.abs(a.removedVolume-b.removedVolume)<1e-14);}
  }
  assert.deepEqual({...walls[1].serialize(),removedVolume:0},{...walls[0].serialize(),removedVolume:0});
  assert(Math.abs(walls[1].removedVolume-walls[0].removedVolume)<1e-13);
  for(let version=0;version<2;version++){total[version].push(...times[version]);aggregate[version].push(...fragmentTimes[version]);}
  report.cases.push({seed,tilt,removedNodes:walls[1].removedNodeCount,removedLitres:walls[1].removedVolume*1000,baseline:stats(times[0]),current:stats(times[1])});
 }
 report.baseline={impact:stats(total[0]),fragmentExtraction:stats(aggregate[0]),snapshotExport:stats(snapshots[0])};
 report.current={impact:stats(total[1]),fragmentExtraction:stats(aggregate[1]),snapshotExport:stats(snapshots[1])};
 report.impactReduction=1-report.current.impact.totalMs/report.baseline.impact.totalMs;
 report.extractionReduction=1-report.current.fragmentExtraction.totalMs/report.baseline.fragmentExtraction.totalMs;
 report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await server.close();}
