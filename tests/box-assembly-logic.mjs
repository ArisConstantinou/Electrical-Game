import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
  const {BoxAssemblyBuilder,boxAssemblyBounds,boxModuleSize}=await server.ssrLoadModule('/src/electrical/BoxAssembly.ts');
  const builder=new BoxAssemblyBuilder('1G');
  builder.cycleCandidate();
  const sequence=[2,2,1];
  for(const zone of sequence)assert(builder.attach(zone),`zone ${zone} should accept a 2G box`);
  builder.cycleCandidate();
  for(const zone of [1,4])assert(builder.attach(zone),`zone ${zone} should accept a 1G box`);
  builder.cycleCandidate();builder.rotateCandidate();
  for(const zone of [4,1,2])assert(builder.attach(zone),`zone ${zone} should continue the rotated 2G puzzle`);
  const snapshot=builder.snapshot;
  assert.equal(snapshot.modules.length,9);
  assert(snapshot.modules.some(module=>module.kind==='1G'));
  assert(snapshot.modules.some(module=>module.kind==='2G'&&module.rotation===1));
  for(let i=0;i<snapshot.modules.length;i++)for(let j=i+1;j<snapshot.modules.length;j++){
    const a=snapshot.modules[i],b=snapshot.modules[j],as=boxModuleSize(a),bs=boxModuleSize(b);
    assert(Math.abs(a.x-b.x)>=(as.width+bs.width)/2-.001||Math.abs(a.y-b.y)>=(as.height+bs.height)/2-.001,`${a.id} overlaps ${b.id}`);
  }
  const bounds=boxAssemblyBounds(snapshot.modules);assert(bounds.width>.2&&bounds.height>.2);
  const blocked=new BoxAssemblyBuilder('1G');assert(blocked.attach(2));assert.equal(blocked.attach(4),null,'returning into the initial box is blocked');assert.equal(blocked.zoneAvailable(4),false);
  console.log(JSON.stringify({passed:true,count:snapshot.modules.length,bounds,active:snapshot.activeId,candidate:snapshot.candidateKind,rotation:snapshot.candidateRotation}));
}finally{await server.close();}
