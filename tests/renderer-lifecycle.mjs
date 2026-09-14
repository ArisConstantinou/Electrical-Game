import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output',{recursive:true});
await build({entryPoints:['src/core/Renderer.ts'],outfile:'output/renderer-lifecycle-bundle.mjs',bundle:true,format:'esm',platform:'node',external:['three','three/*']});
const {Renderer}=await import('../output/renderer-lifecycle-bundle.mjs?'+Date.now());
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const report={cases:[]};
function fixture(){
 const r=Object.create(Renderer.prototype);let draws=0,rebuilds=0,resizes=0;
 Object.assign(r,{ready:Promise.resolve(),suspended:false,deviceLost:false,contextLost:false,contextRestored:null,recoveryTask:null,renderGeneration:0,recoveryCount:0,renderTask:null,pendingSize:null,waterWasVisible:true,lastRenderTime:performance.now(),roomWater:{surface:{visible:true}},water:{update:()=>Promise.resolve()},gpu:{info:{reset(){}},render(){draws++;}},scene:{},renderCamera:{},renderError:''});
 r.snapshotRenderCamera=()=>{};r.prepareMaterials=()=>{};r.resize=()=>{resizes++;};
 r.rebuildGraphics=async()=>{r.renderGeneration++;r.renderTask=null;rebuilds++;r.recoveryCount++;r.deviceLost=false;};
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
report.passed=true;await writeFile('output/renderer-lifecycle.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
