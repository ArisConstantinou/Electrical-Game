import assert from 'node:assert/strict';
import * as THREE from 'three';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output',{recursive:true});
await build({entryPoints:['src/core/Renderer.ts'],outfile:'output/renderer-lifecycle-bundle.mjs',bundle:true,format:'esm',platform:'node',external:['three','three/*']});
const {Renderer}=await import('../output/renderer-lifecycle-bundle.mjs?'+Date.now());
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const report={cases:[]};
function fixture(){
 const r=Object.create(Renderer.prototype);let draws=0,rebuilds=0,resizes=0;
 Object.assign(r,{ready:Promise.resolve(),suspended:false,deviceLost:false,contextLost:false,contextRestored:null,recoveryTask:null,renderGeneration:0,recoveryCount:0,renderTask:null,submittedFrames:new Set(),queueWaitMaxMs:0,pendingSize:null,waterWasVisible:true,lastRenderTime:performance.now(),roomWater:{surface:{visible:true}},water:{update:()=>Promise.resolve()},gpu:{backend:{},info:{reset(){}},render(){draws++;}},scene:{},renderCamera:{},renderError:''});
 r.snapshotRenderCamera=()=>{};r.prepareMaterials=()=>{};r.resize=()=>{resizes++;};r.waterInView=()=>true;
 r.rebuildGraphics=async()=>{r.renderGeneration++;r.renderTask=null;r.submittedFrames.clear();rebuilds++;r.recoveryCount++;r.deviceLost=false;};
 return{r,draws:()=>draws,rebuilds:()=>rebuilds,resizes:()=>resizes};
}
{
 const f=fixture(),first=deferred();f.r.water.update=()=>first.promise;assert(f.r.render());assert(f.r.framePending);
 f.r.suspend();assert(f.r.framePending);first.resolve();await f.r.waitForFrame();assert.equal(f.draws(),0,'Suspended frame must not draw');
 await f.r.resume();assert(!f.r.framePending);assert.equal(f.rebuilds(),0,'A completed normal frame must reuse its graphics');assert.equal(f.resizes(),1);
 report.cases.push('ordinary suspension reuses graphics without stale draw');
}
{
 const f=fixture(),old=deferred();f.r.water.update=()=>old.promise;f.r.render();f.r.suspend();
 const resume=f.r.resume(),duplicate=f.r.resume();assert(f.r.framePending);await Promise.all([resume,duplicate]);
 assert.equal(f.rebuilds(),1,'A permanently pending optical frame must rebuild once');assert(!f.r.framePending);
 const current=deferred();f.r.water.update=()=>current.promise;assert(f.r.render());const fence=f.r.renderTask;
 old.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.r.renderTask,fence,'Late retired frame must not clear the new frame fence');assert.equal(f.draws(),0,'Retired frame must never draw');
 current.resolve();await f.r.waitForFrame();assert.equal(f.draws(),1);assert(!f.r.framePending);
 report.cases.push('stalled optical frame recovers and rejects stale draw/fence completion');
}
{
 const f=fixture(),restored=deferred();f.r.deviceLost=true;f.r.contextLost=true;f.r.contextRestored=restored.promise;f.r.suspend();
 const resume=f.r.resume();await Promise.resolve();assert.equal(f.rebuilds(),0,'Wait until real WebGL context is restored before rebuilding');
 f.r.contextLost=false;f.r.contextRestored=null;restored.resolve();await resume;assert.equal(f.rebuilds(),1);assert(!f.r.framePending);
 report.cases.push('WebGL loss waits for restoration then rebuilds graphics');
}
{
 const f=fixture(),old=deferred();f.r.water.update=()=>old.promise;f.r.render();f.r.suspend();const resume=f.r.resume();
 f.r.suspend();old.resolve();await resume;assert(f.r.framePending,'A second screen lock while resuming stays suspended');
 await f.r.resume();assert(!f.r.framePending);assert.equal(f.rebuilds(),0);
 report.cases.push('repeated lock during resume stays paused until another wake');
}
{
 const f=fixture(),old=deferred();f.r.water.update=()=>old.promise;f.r.render();f.r.suspend();const firstWake=f.r.resume();
 f.r.suspend();const secondWake=f.r.resume();old.resolve();await Promise.all([firstWake,secondWake]);
 assert(!f.r.framePending,'A second wake before the first recovery finishes must clear the latest suspension');assert.equal(f.rebuilds(),0);
 report.cases.push('second wake during in-flight recovery releases the latest suspension');
}
{
 const f=fixture();let losses=0,disposals=0;
 const extensions={get(name){return name==='WEBGL_lose_context'?{loseContext(){losses++;}}:{name};}},originalGet=extensions.get;
 const renderer={backend:{isWebGLBackend:true,extensions},dispose(){disposals++;assert.equal(extensions.get('other').name,'other');extensions.get('WEBGL_lose_context')?.loseContext();}};
 f.r.disposePreservingCanvas(renderer);assert.equal(disposals,1);assert.equal(losses,0,'Retiring a WebGL renderer must not lose the restored shared canvas again');assert.equal(extensions.get,originalGet);
 f.r.disposePreservingCanvas({backend:{},dispose(){disposals++;}});assert.equal(disposals,2,'WebGPU retirement still performs normal disposal');
 report.cases.push('WebGL retirement frees resources without losing the restored canvas');
}
{
 const f=fixture(),a=deferred(),b=deferred(),c=deferred(),fences=[a,b,c];f.r.water=null;
 f.r.gpu.backend={device:{queue:{onSubmittedWorkDone:()=>fences.shift().promise}}};
 assert(f.r.render());assert.equal(f.r.framePending,false,'Allow CPU/GPU overlap with one outstanding image');
 assert(f.r.render());assert(f.r.framePending);assert.equal(f.r.render(),false,'Never submit a third image while two are outstanding');
 a.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.r.framePending,false);
 assert(f.r.render());assert.equal(f.draws(),3);b.resolve();c.resolve();await f.r.waitForFrame();assert.equal(f.r.submittedFrames.size,0);
 report.cases.push('two-frame GPU queue bound preserves overlap without unlimited submissions');
}
{
 const f=fixture(),optical=deferred(),gpu=deferred();f.r.water.update=()=>optical.promise;
 f.r.gpu.backend={device:{queue:{onSubmittedWorkDone:()=>gpu.promise}}};
 f.r.render();let completed=false;const wait=f.r.waitForFrame().then(()=>{completed=true;});
 optical.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false,'Wait for GPU completion after optical passes submit their colour image');
 gpu.resolve();await wait;assert.equal(completed,true);
 report.cases.push('optical frame wait includes the subsequently submitted GPU image');
}
{
 const f=fixture(),gpu=deferred(),callbacks=[],events=[],previousWindow=globalThis.window,previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout;
 Object.assign(f.r,{graphicsErrors:[],faultAttempts:0,graphicsFault:false,recoveryBlocked:false,water:null});
 f.r.gpu.backend={device:{queue:{onSubmittedWorkDone:()=>gpu.promise}}};
 globalThis.window=new EventTarget();window.addEventListener('wirehouse:graphics-lost',()=>events.push('lost'));
 globalThis.setTimeout=(callback,ms)=>{assert.equal(ms,10000);callbacks.push(callback);return -1;};globalThis.clearTimeout=()=>{};
 try{
  f.r.render();callbacks[0]();callbacks[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(events.length,1,'A stalled completion requests one recovery, not unlimited submissions');
  assert(f.r.framePending);assert(f.r.graphicsErrors[0].message.includes('no completion within 10000 ms'));
  await assert.rejects(f.r.waitForFrame(),/no completion within 10000 ms/,'A startup GPU stall must reach the loading failure UI instead of waiting forever');gpu.resolve();
 }finally{globalThis.window=previousWindow;globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;}
 report.cases.push('GPU completion watchdog records the stall and requests bounded recovery');
}
{
 const f=fixture(),gpu=deferred(),callbacks=[],previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout,clockDescriptor=Object.getOwnPropertyDescriptor(performance,'now');let now=1000;
 f.r.water=null;f.r.gpu.backend={device:{queue:{onSubmittedWorkDone:()=>gpu.promise}}};
 Object.defineProperty(performance,'now',{configurable:true,value:()=>now});globalThis.setTimeout=callback=>{callbacks.push(callback);return -1;};globalThis.clearTimeout=()=>{};
 try{
  f.r.render();now=16000;callbacks[0]();assert.equal(callbacks.length,2,'A late browser timer must allow pending GPU completion notifications to run');
  assert.equal(f.r.graphicsFault,undefined,'CPU-blocked shader preparation must not be classified as a GPU fault');
  gpu.resolve();await f.r.waitForFrame();
 }finally{globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;if(clockDescriptor)Object.defineProperty(performance,'now',clockDescriptor);else delete performance.now;}
 report.cases.push('late timer after CPU-blocked loading does not trigger graphics recovery');
}
{
 const f=fixture(),scene=new THREE.Scene(),sun=new THREE.DirectionalLight(),source=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),samples=new THREE.Group();
 sun.castShadow=true;sun.shadow.autoUpdate=false;scene.add(sun,source);Object.assign(f.r,{scene,camera:new THREE.PerspectiveCamera(),renderCamera:new THREE.PerspectiveCamera()});
 let target=null;Object.assign(f.r.gpu,{compileAsync:async()=>{},getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},render:()=>{assert.equal(source.visible,false);sun.shadow.needsUpdate=false;}});
 await f.r.prepareToolResources(samples);
 assert.equal(source.visible,true);assert.equal(samples.parent,null);assert.equal(target,null);assert.equal(sun.shadow.needsUpdate,true,'Sample-only warmup must not leave an empty cached sun map after recovery');
 report.cases.push('tool warmup restores full-site shadow invalidation for the first recovered frame');
}
report.passed=true;await writeFile('output/renderer-lifecycle.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
