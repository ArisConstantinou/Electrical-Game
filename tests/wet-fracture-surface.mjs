import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import {createServer} from 'vite';

const output='output/wet-fracture-surface';await mkdir(output,{recursive:true});
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
const report={fixture:'Production horizontal masonry; 70 normal chisel impacts; real first-hit water contacts. No renderer or mocked surface triangles.'};
try{
  const {MasonryVolume}=await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const {MortarSystem}=await server.ssrLoadModule('/src/systems/MortarSystem.ts');
  const volume=new MasonryVolume({seed:193187});
  for(let i=0;i<70;i++){
    const x=.64+(i%7)*.022,y=1.40+Math.floor(i/7)*.016,hit=volume.raycast({x,y,z:-2},{x:0,y:0,z:-1},.8);
    if(hit)volume.impact({point:hit.point,direction:{x:0,y:0,z:-1},edge:{x:1,y:0,z:0},chisel:'flat',widthM:.05,energyJ:8});
  }
  const cacheStart=performance.now();for(const key of volume.takeDirtyChunks())volume.cacheSurfaceMesh(key,volume.buildChunkMesh(key).positions);report.productionMeshCache={seedMs:performance.now()-cacheStart,entries:volume.surfaceMeshes.size,bytes:[...volume.surfaceMeshes.values()].reduce((sum,p)=>sum+p.byteLength,0)};
  const mortar=new MortarSystem(new THREE.Scene(),{volume},[]);let delivered=0,absorbed=0,runoff=0;
  const costs={};for(const [object,name]of [[volume,'buildChunkMesh'],[volume,'surfaceTriangles'],[mortar,'contact'],[mortar,'fractureWaterFootprint']]){const original=object[name].bind(object);costs[name]={count:0,ms:0,max:0};object[name]=(...args)=>{const start=performance.now();const result=original(...args);const elapsed=performance.now()-start;costs[name].count++;costs[name].ms+=elapsed;costs[name].max=Math.max(costs[name].max,elapsed);return result;};}report.costs=costs;const start=performance.now();
  for(let y=1.38;y<1.59;y+=.012)for(let x=.59;x<.84;x+=.012){
    const hit=volume.raycast({x,y,z:-2},{x:0,y:0,z:-1},.8);if(!hit)continue;
    const result=mortar.applyWater(new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z),new THREE.Vector3(hit.normal.x,hit.normal.y,hit.normal.z),.015);
    delivered+=.015;absorbed+=result.absorbedLitres;runoff+=result.runoffLitres;
  }
  report.receiveWaterMs=performance.now()-start;
  const initialCount=costs.fractureWaterFootprint.count;
  assert.equal(initialCount,0,'Water absorption must not build geometry synchronously');
  const queued=mortar.pendingWetGeometry;assert.equal(queued,mortar.water.size);
  for(let i=0;i<5;i++)mortar.update(0);
  assert.equal(costs.fractureWaterFootprint.count,initialCount,'Physics catch-up must not tessellate wet surfaces');
  const geometryStart=performance.now();let presentedFrames=0;
  while(mortar.pendingWetGeometry){const before=costs.fractureWaterFootprint.count;assert.equal(mortar.flushWetGeometry(1),1);assert.equal(costs.fractureWaterFootprint.count,before+1,'One presented frame may build at most one requested patch');presentedFrames++;}
  report.queuedPresentation={initialCells:queued,presentedFrames,geometryMs:performance.now()-geometryStart};
  const analyze=()=>{
    let triangles=0,inside=0,samples=0,area=0;
    for(const cell of mortar.water.values()){
      const positions=cell.patch.batch.mesh.geometry.getAttribute('position');
      for(let i=cell.patch.start;i<cell.patch.start+cell.patch.count;i+=3){
        triangles++;const a=new THREE.Vector3().fromBufferAttribute(positions,i),b=new THREE.Vector3().fromBufferAttribute(positions,i+1),c=new THREE.Vector3().fromBufferAttribute(positions,i+2);
        const triangleArea=new THREE.Triangle(a,b,c).getArea();area+=triangleArea;if(triangleArea<1e-12)continue;
        for(const weights of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){
          const point=a.clone().multiplyScalar(weights[0]).addScaledVector(b,weights[1]).addScaledVector(c,weights[2]);samples++;
          if(volume.isOccupied(point.x,point.y,point.z)){inside++;(report.penetrations??=[]).push({point:point.toArray(),triangle:[a.toArray(),b.toArray(),c.toArray()]});}
        }
      }
    }
    return{cells:mortar.water.size,empty:[...mortar.water.values()].filter(cell=>!cell.patch.count).length,triangles,samples,inside,area,drawCalls:mortar.telemetry.wetDrawCalls};
  };
  report.creationMs=performance.now()-start;report.first=analyze();
  assert.equal(report.first.inside,0,'Wet triangles must not intersect the fractured masonry');
  assert(report.first.empty<report.first.cells*.25,'Most contacted fracture cells must actually display moisture');
  assert(report.first.area>.05,'Conforming wetting must retain a meaningful covered surface area');
  assert(Math.abs(delivered-absorbed-runoff)<1e-8,'Delivered water must remain absorbed water plus runoff');
  const snapshots=[...mortar.water.values()].map(cell=>({cell,patch:cell.patch,positions:Array.from(cell.patch.batch.mesh.geometry.getAttribute('position').array.slice(cell.patch.start*3,(cell.patch.start+cell.patch.count)*3))}));
  for(let frame=0;frame<15;frame++)mortar.update(1/60);
  for(const {cell,patch,positions}of snapshots){assert.equal(cell.patch,patch,'An unchanged wall must not rebuild its wet patches each frame');assert.deepEqual(Array.from(patch.batch.mesh.geometry.getAttribute('position').array.slice(patch.start*3,(patch.start+patch.count)*3)),positions,'Stationary absorbed moisture geometry must stay fixed');}
  const oldVersion=volume.surfaceRevision;
  for(let i=0;i<20;i++){const hit=volume.raycast({x:.62+(i%5)*.02,y:1.41+Math.floor(i/5)*.02,z:-2},{x:0,y:0,z:-1},.8);if(hit)volume.impact({point:hit.point,direction:{x:0,y:0,z:-1},chisel:'flat',energyJ:12});}
    assert(volume.surfaceRevision>oldVersion);const beforeRebuild=costs.fractureWaterFootprint.count;mortar.update(0);
  const changedQueued=mortar.pendingWetGeometry;assert(changedQueued>0);
  for(let i=0;i<5;i++)mortar.update(0);
  assert.equal(costs.fractureWaterFootprint.count,beforeRebuild,'Chiselling must queue changed moisture instead of rebuilding it in physics');
  assert([...mortar.water.values()].filter(cell=>cell.patch.pending).every(cell=>cell.patch.count===0),'Stale wall facets must be hidden while awaiting reconstruction');
  assert.equal(mortar.flushWetGeometry(64,0),1,'Time budget must yield after the first completed patch');
  assert.equal(mortar.pendingWetGeometry,changedQueued-1);
  while(mortar.pendingWetGeometry>1)assert.equal(mortar.flushWetGeometry(1),1);
  await mortar.waitForGeometry();assert.equal(mortar.pendingWetGeometry,0,'Explicit geometry readiness must include queued wet surfaces');
  report.afterChisel=analyze();report.queuedPresentation.afterChiselCells=changedQueued;
  assert.equal(report.afterChisel.inside,0,'Later chiselling must invalidate and reproject affected moisture facets');
  assert([...mortar.water.values()].some(cell=>!snapshots.some(item=>item.cell===cell&&item.patch===cell.patch)),'Changed wall geometry must refresh affected wet patches');
  report.deliveredLitres=delivered;report.absorbedLitres=absorbed;report.runoffLitres=runoff;report.passed=true;
  console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await server.close();}
