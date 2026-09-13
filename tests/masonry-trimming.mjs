import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const server = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
const report = {};
try {
  const {MasonryVolume} = await server.ssrLoadModule('/src/world/MasonryVolume.ts');
  const options = {seed:193187,maxConnectivityNodes:16};
  const v = new MasonryVolume(options), front = v.frontZ;
  const hitAt = (volume,x,y) => volume.raycast({x,y,z:front+.3},{x:0,y:0,z:-1},.6);
  const strike = (volume,x,y,trim=false) => {
    const hit = hitAt(volume,x,y); assert(hit,'Fixture must retain real material contact');
    return volume.impact({point:hit.point,direction:trim?{x:0,y:Math.SQRT1_2,z:-Math.SQRT1_2}:{x:0,y:0,z:-1},edge:{x:1,y:0,z:0},chisel:'flat',energyJ:4,trim});
  };
  const drain = volume => { let iterations=0,total=0; while(volume.pendingSupportCount && iterations++<3000) total+=volume.processPendingSupport(128)?.removedNodes??0; assert.equal(volume.pendingSupportCount,0,'Connectivity must finish'); return total; };
  const nodeEdits = volume => {
    const map=new Map();
    for(const chunk of volume.serialize().chunks) {
      const [tx,ty]=chunk.key.split(',').map(Number);
      for(const [offset,damage,removed] of chunk.edits) {
        const z=offset%(volume.nz+2),xy=Math.floor(offset/(volume.nz+2));
        const x=tx*volume.tileSize+xy%volume.tileSize,y=ty*volume.tileSize+Math.floor(xy/volume.tileSize);
        map.set(`${x},${y},${z}`,{x,y,z,damage,removed,p:volume.nodePosition(x,y,z)});
      }
    }
    return map;
  };
  // Factory hollows cannot supply a finishing plane. Preserve normal upward
  // surface chipping until the front shell actually opens.
  const pristine = new MasonryVolume(options); let intactRemoved=0, surfaceImpacts=0;
  for(let i=0;i<8;i++) {
    const r=strike(pristine,.792,1.542,true);
    if(r.stats.trimMode) break;
    surfaceImpacts++;intactRemoved+=r.removedNodes;
    assert.equal(pristine.trimmingState,null);
  }
  const ordinary = new MasonryVolume(options), upward = new MasonryVolume(options);
  const pristineHit=hitAt(ordinary,.792,1.542);
  ordinary.impact({point:pristineHit.point,direction:{x:0,y:Math.SQRT1_2,z:-Math.SQRT1_2},edge:{x:1,y:0,z:0},chisel:'flat',energyJ:4});
  strike(upward,.792,1.542,true);
  assert.deepEqual(upward.serialize().chunks,ordinary.serialize().chunks,'Pristine upward strike is the original local impact, not hidden-cavity trimming');
  assert(surfaceImpacts>0 && intactRemoved>0,'Upward contact must retain normal surface chipping');
  for(let i=0;i<12;i++) strike(v,.8+Math.sin(i*2.4)*.043,1.55+Math.cos(i*2.4)*.043);
  drain(v);
  const cavity = v.serialize(), before=nodeEdits(v), first = strike(v,.792,1.542,true);
  const plane=v.trimmingState.floorZ;
  assert(plane<front-.04 && plane>front-.08,'Use first exposed local chamber backing');
  let removed=first.removedNodes;
  for(let i=0;i<40;i++) { removed+=strike(v,.792,1.542,true).removedNodes; assert.equal(v.trimmingState.floorZ,plane,'Repeated finishing must not ratchet the backing deeper'); }
  const pendingBefore=v.pendingSupportCount;
  const pendingSave=v.serialize();
  const restored=new MasonryVolume(options);restored.restore(pendingSave);
  assert.deepEqual(restored.serialize(),pendingSave,'Guarded pending support jobs survive save/load');
  removed+=drain(v);drain(restored);
  assert.deepEqual(restored.serialize().chunks,v.serialize().chunks,'Deferred guarded support is deterministic after restore');
  assert(removed>30,'Upward finishing must actually remove protruding clay');
  let changed=0,clayRemoved=0;
  for(const [key,node] of nodeEdits(v)) {
    const prior=before.get(key);
    if(node.damage===(prior?.damage??0)&&node.removed===(prior?.removed??0)) continue;
    changed++;
    assert(Math.abs(node.p.x-.792)<.2 && Math.abs(node.p.y-1.542)<.2,'Finishing cannot damage a remote wall patch');
    assert(node.p.z>plane+v.hz+1e-9,'Neither fracture weakness nor deferred islands may cross the protected backing');
    if(node.removed&&!prior?.removed&&v.baseMaterial(node.x,node.y,node.z)===1)clayRemoved++;
  }
  assert(clayRemoved>20);
  // The same chisel returned straight can intentionally excavate deeper.
  const protectedBefore=nodeEdits(v);
  for(let i=0;i<20;i++) strike(v,.792,1.542);
  assert.equal(v.trimmingState,null,'A normal stroke exits and clears finishing plane');drain(v);
  assert([...nodeEdits(v)].some(([key,n])=>n.p.z<=plane&&(n.removed??0)>(protectedBefore.get(key)?.removed??0)),'Normal excavation must still remove deeper material');
  // A distant exposed patch has its own shallower plane, never the wall-wide deepest point.
  v.restore(cavity);
  for(let i=0;i<8;i++) strike(v,.3+Math.sin(i*2.4)*.03,1.55+Math.cos(i*2.4)*.03);
  drain(v);strike(v,.792,1.542,true);const firstAnchor=v.trimmingState.anchor;
  strike(v,.3,1.55,true);
  assert(!v.trimmingState || Math.abs(v.trimmingState.anchor.x-firstAnchor.x)>.2,'Moving to another patch re-establishes local depth');
  strike(v,-1,1.5,true);assert.equal(v.trimmingState,null,'Moving to pristine masonry cannot carry over old plane');
  report.intactUpwardRemoved=intactRemoved;report.localDepthMm=(front-plane)*1000;report.trimmedNodes=removed;report.changedNodes=changed;report.clayNodesRemoved=clayRemoved;report.pendingJobsExercised=pendingBefore;report.checks=['pristine upward surface chipping','real clay rib removal','40-hit fixed backing','no protected damage or detachment','save/load guarded support','normal deeper excavation','local patch transition','pristine transition'];
} finally { await server.close(); }
await mkdir('output/masonry-trimming',{recursive:true});await writeFile('output/masonry-trimming/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
